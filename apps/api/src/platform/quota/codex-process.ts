import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import type { ResolvedExecutable } from '../../providers/provider-adapter.js';
import { buildChildEnvironment } from '../../providers/process/environment-policy.js';
import { ProcessTreeKiller } from '../../providers/process/process-tree-killer.js';
import { normalizeCodexQuota } from './codex-quota.js';
import { unavailable, type QuotaMeasurement } from './quota-source.js';

const failed = (): QuotaMeasurement => ({
  status: 'error',
  reason: 'source_error',
  windows: [],
});
const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Single read-only session; no threads/turns, credentials, reset-credit calls or
 * log forwarding. Account payloads exist only while projecting auth mode. */
export async function readCodexQuotaProcess(
  command: ResolvedExecutable,
  signal: AbortSignal,
  options: {
    timeoutMs?: number;
    environment?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<QuotaMeasurement> {
  if (
    !isAbsolute(command.executablePath) ||
    ['.cmd', '.bat'].includes(extname(command.executablePath).toLowerCase()) ||
    !statSync(command.executablePath).isFile()
  )
    throw new Error('Invalid quota executable');
  // Prefixes come from the trusted CLI resolver, never from HTTP input.
  if (
    command.prefixArgs.length &&
    (!isAbsolute(command.prefixArgs[0]!) ||
      !statSync(command.prefixArgs[0]!).isFile())
  )
    throw new Error('Invalid quota executable prefix');
  if (signal.aborted) return failed();
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000)
    throw new Error('Invalid quota timeout');
  const environment = buildChildEnvironment({
    parent: options.environment ?? process.env,
    provider: 'codex',
    overrides: { NO_COLOR: '1' },
  });
  const killer = new ProcessTreeKiller({ graceMs: 100 });
  return new Promise((resolve) => {
    const child = spawn(
      command.executablePath,
      [...command.prefixArgs, 'app-server', '--listen', 'stdio://'],
      {
        cwd: tmpdir(),
        env: environment,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let finished = false;
    let exited = false;
    let buffer = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let expected = 0;
    const finish = (result: QuotaMeasurement) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      buffer = '';
      // Kill before closing stdin so Windows descendants remain discoverable.
      const cleanup = child.pid
        ? killer.terminate(child.pid, () => exited)
        : Promise.resolve();
      const bound = setTimeout(() => {
        child.kill('SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        resolve(result);
      }, 4000);
      void cleanup
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(bound);
          child.stdout.destroy();
          child.stderr.destroy();
          child.stdin.destroy();
          resolve(result);
        });
    };
    const send = (value: unknown) => {
      if (!finished) child.stdin.write(JSON.stringify(value) + '\n');
    };
    const abort = () => finish(failed());
    const timer = setTimeout(abort, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    child.once('error', abort);
    child.stdin.on('error', abort);
    child.once('exit', () => {
      exited = true;
    });
    child.once('close', () => {
      if (child.pid) killer.killRemainingDescendants(child.pid);
      finish(failed());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 16384) abort();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      if (finished) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > 262144) {
        abort();
        return;
      }
      buffer += chunk.toString('utf8');
      while (!finished && buffer.includes('\n')) {
        const end = buffer.indexOf('\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message: Record<string, unknown> | undefined;
        try {
          message = object(JSON.parse(line));
        } catch {
          abort();
          return;
        }
        if (!message) {
          abort();
          return;
        }
        // Notifications are not quota snapshots. Server requests requiring any
        // permission/auth response are never fulfilled by this transport.
        if (message.id === undefined) continue;
        if (message.id !== expected) {
          abort();
          return;
        }
        const error = object(message.error);
        if (error) {
          if (error.code === -32601) finish(unavailable('unsupported_source'));
          else if (
            typeof error.message === 'string' &&
            /(?:chatgpt|codex account) authentication required/i.test(
              error.message,
            )
          )
            finish({
              status: 'unauthenticated',
              reason: 'login_required',
              windows: [],
            });
          else abort();
          return;
        }
        const result = object(message.result);
        if (!result) {
          abort();
          return;
        }
        if (expected === 0) {
          send({ method: 'initialized', params: {} });
          expected = 1;
          send({
            method: 'account/read',
            id: 1,
            params: { refreshToken: false },
          });
        } else if (expected === 1) {
          if (result.account === null) {
            finish({
              status: 'unauthenticated',
              reason: 'login_required',
              windows: [],
            });
            return;
          }
          const account = object(result.account);
          if (!account || typeof account.type !== 'string') {
            abort();
            return;
          }
          if (account.type !== 'chatgpt') {
            finish(unavailable('unsupported_auth'));
            return;
          }
          expected = 2;
          send({ method: 'account/rateLimits/read', id: 2 });
        } else finish(normalizeCodexQuota(result));
      }
    });
    send({
      method: 'initialize',
      id: 0,
      params: {
        clientInfo: {
          name: 'pr_review_orchestrator_quota',
          title: 'PR Review Orchestrator quota',
          version: '0.0.1',
        },
      },
    });
    if (signal.aborted) abort();
  });
}
