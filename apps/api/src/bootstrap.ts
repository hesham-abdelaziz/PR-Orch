import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppModule } from './app.module.js';
import type { PlatformOptions } from './platform/platform.module.js';
import { SecretValuesService } from './secrets/secret-store.js';
import { redactSecrets } from './providers/redact-secrets.js';
import { acquireRuntimeLease } from './platform/runtime-lease.js';
import {
  REVIEW_WORKSPACE_PORT,
  type ReviewWorkspacePort,
} from './reviews/review-ports.js';

export interface LocalApplicationOptions extends PlatformOptions {
  webRoot?: string;
}

export function locateGit(env: NodeJS.ProcessEnv): string {
  const pathKey = Object.keys(env).find((key) =>
    process.platform === 'win32'
      ? key.toLowerCase() === 'path'
      : key === 'PATH',
  );
  for (const directory of (pathKey ? (env[pathKey] ?? '') : '').split(
    delimiter,
  )) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(
      directory,
      process.platform === 'win32' ? 'git.exe' : 'git',
    );
    if (existsSync(candidate)) return realpathSync(candidate);
  }
  throw new Error(
    'Git is unavailable. Install Git for Windows and restart the application.',
  );
}

export function runtimeOptions(
  env: NodeJS.ProcessEnv = process.env,
): LocalApplicationOptions & { port: number } {
  const portText = env.PORT ?? '3000';
  if (
    !/^\d+$/.test(portText) ||
    Number(portText) < 1 ||
    Number(portText) > 65535
  )
    throw new Error('Invalid local server port');
  const dataRoot =
    env.PR_ORCHESTRATOR_DATA_ROOT ??
    join(
      env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'pr-review-orchestrator',
    );
  if (!isAbsolute(dataRoot))
    throw new Error('Application data root must be absolute');
  return {
    dataRoot: resolve(dataRoot),
    port: Number(portText),
    gitExecutable: locateGit({ ...process.env, ...env }),
    webRoot: fileURLToPath(
      new URL('../../web/dist/web/browser/', import.meta.url),
    ),
  };
}

/** Do not expose database, Credential Manager, network, or CLI diagnostics. */
class LocalErrorFilter implements ExceptionFilter {
  constructor(private readonly secrets: SecretValuesService) {}
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) {
      response.end();
      return;
    }
    let status = 500;
    let payload: unknown = {
      statusCode: 500,
      message:
        'Local service operation failed. Check configuration and try again.',
    };
    if (error instanceof HttpException) {
      status = error.getStatus();
      payload = error.getResponse();
    } else if (error instanceof ZodError) {
      status = 400;
      payload = {
        statusCode: 400,
        message: 'Invalid request',
        issues: error.issues
          .map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          }))
          .slice(0, 20),
      };
    } else if ((error as { type?: string })?.type === 'entity.too.large') {
      status = 413;
      payload = {
        statusCode: 413,
        message: 'Request body exceeds the local upload limit',
      };
    } else if ((error as { type?: string })?.type === 'entity.parse.failed') {
      status = 400;
      payload = { statusCode: 400, message: 'Invalid JSON request body' };
    }
    if (typeof payload === 'string')
      payload = { statusCode: status, message: payload };
    response
      .status(status)
      .json(
        JSON.parse(
          redactSecrets(JSON.stringify(payload), this.secrets.values()),
        ),
      );
  }
}

export async function createLocalApplication(
  options: LocalApplicationOptions,
): Promise<NestExpressApplication> {
  const release = await acquireRuntimeLease(options.dataRoot);
  let app: NestExpressApplication | undefined;
  try {
    app = await NestFactory.create<NestExpressApplication>(
      AppModule.forRoot({ ...options, onShutdown: release }),
      { logger: false, bodyParser: false, abortOnError: false },
    );
    app.getHttpAdapter().getInstance().disable('x-powered-by');
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
      // Also protect static assets and the SPA from DNS rebinding.
      if (
        !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host ?? '') ||
        (req.headers.host?.includes(':') &&
          Number(req.headers.host.split(':')[1]) !== req.socket.localPort)
      ) {
        res
          .status(401)
          .json({ statusCode: 401, message: 'Invalid local request host' });
        return;
      }
      next();
    });
    app.useBodyParser('json', { limit: '7mb' });
    app.useGlobalFilters(new LocalErrorFilter(app.get(SecretValuesService)));
    if (options.webRoot && existsSync(join(options.webRoot, 'index.html'))) {
      app.useStaticAssets(options.webRoot, {
        index: false,
        dotfiles: 'deny',
        fallthrough: true,
      });
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (
          req.method === 'GET' &&
          !/^\/api(?:\/|$)/.test(req.path) &&
          req.accepts('html')
        )
          res.sendFile('index.html', {
            root: resolve(options.webRoot!),
            dotfiles: 'deny',
          });
        else next();
      });
    }
    app.enableShutdownHooks();
    await app.init(); // Engine recovery completes before a socket is bound.
    const workspace = app.get<ReviewWorkspacePort>(REVIEW_WORKSPACE_PORT);
    let entries: string[] = [];
    try {
      entries = await readdir(join(options.dataRoot, 'workspaces'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    // Includes checkouts left by a crash before the engine stored workspaceId.
    for (const id of entries)
      if (/^job-[a-zA-Z0-9_-]+$/.test(id)) await workspace.cleanup(id);
    return app;
  } catch (error) {
    try {
      await app?.close();
    } finally {
      await release();
    }
    throw error;
  }
}
