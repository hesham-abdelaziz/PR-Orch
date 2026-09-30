import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import type { ProviderId } from '@pr-orchestrator/contracts';

import type { CliLocator, ResolvedExecutable } from './provider-adapter.js';

export interface FileSystemPort {
  isFile(path: string): boolean;
  readText(path: string): string | undefined;
}

export const nodeFileSystem: FileSystemPort = {
  isFile(path) {
    try {
      if (!statSync(path).isFile()) return false;
      if (process.platform !== 'win32') accessSync(path, constants.X_OK);

      return true;
    } catch {
      return false;
    }
  },
  readText(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return undefined;
    }
  },
};

export interface WindowsCliResolverOptions {
  platform?: NodeJS.Platform;
  environment?: Readonly<Record<string, string | undefined>>;
  fileSystem?: FileSystemPort;
  /** Absolute path of the Node binary used to run npm-installed CLIs. */
  nodeExecutablePath?: string;
}

// `"%dp0%\node_modules\...\entry.js" %*` is the launch line npm writes into
// every .cmd shim.
const SHIM_LAUNCH_PATTERN = /"%dp0%\\([^"\r\n]+?)"\s+%\*/giu;
const JAVASCRIPT_ENTRY = /\.(?:c|m)?js$/iu;

/**
 * Locates provider CLIs by absolute path without ever involving a shell.
 * Native executables are used directly; npm `.cmd` shims are resolved to their
 * JavaScript entry point and launched through the current Node binary.
 */
export class WindowsCliResolver implements CliLocator {
  private readonly platform: NodeJS.Platform;
  private readonly environment: Readonly<Record<string, string | undefined>>;
  private readonly fileSystem: FileSystemPort;
  private readonly nodeExecutablePath: string;

  constructor(options: WindowsCliResolverOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? process.env;
    this.fileSystem = options.fileSystem ?? nodeFileSystem;
    this.nodeExecutablePath = options.nodeExecutablePath ?? process.execPath;
  }

  locate(command: ProviderId): ResolvedExecutable | undefined {
    const candidates = this.resolveAll(command);

    // Codex ships a native executable; prefer it to the npm shim when both exist.
    if (command === 'codex') {
      const native = candidates.find((candidate) => candidate.prefixArgs.length === 0);
      if (native) return native;
    }

    return candidates[0];
  }

  /** Locates any PATH executable, e.g. a container runtime for Gemini's sandbox. */
  locateExecutable(command: string): ResolvedExecutable | undefined {
    return this.resolveAll(command)[0];
  }

  private get isWindows(): boolean {
    return this.platform === 'win32';
  }

  private get pathApi(): typeof win32 {
    return (this.isWindows ? win32 : posix) as typeof win32;
  }

  private environmentValue(name: string): string | undefined {
    const wanted = name.toUpperCase();
    const key = Object.keys(this.environment).find((candidate) => candidate.toUpperCase() === wanted);

    return key === undefined ? undefined : this.environment[key];
  }

  private searchDirectories(): string[] {
    const raw = this.environmentValue('PATH') ?? '';

    return raw
      .split(this.pathApi.delimiter)
      .map((entry) => entry.trim().replace(/^"(.*)"$/u, '$1'))
      .filter((entry) => entry.length > 0 && this.pathApi.isAbsolute(entry));
  }

  private extensions(): string[] {
    if (!this.isWindows) return [''];

    const configured = (this.environmentValue('PATHEXT') ?? '.EXE;.CMD')
      .toLowerCase()
      .split(';');

    return ['.exe', '.cmd'].filter((extension) => configured.includes(extension));
  }

  private resolveAll(command: string): ResolvedExecutable[] {
    const resolved: ResolvedExecutable[] = [];

    for (const directory of this.searchDirectories()) {
      for (const extension of this.extensions()) {
        const candidate = this.pathApi.join(directory, `${command}${extension}`);
        if (!this.fileSystem.isFile(candidate)) continue;

        const executable =
          extension === '.cmd'
            ? this.resolveNpmShim(candidate)
            : { executablePath: candidate, prefixArgs: [] };
        if (executable) resolved.push(executable);
      }
    }

    return resolved;
  }

  private resolveNpmShim(shimPath: string): ResolvedExecutable | undefined {
    const content = this.fileSystem.readText(shimPath);
    if (content === undefined) return undefined;

    const matches = [...content.matchAll(SHIM_LAUNCH_PATTERN)];
    const relativeEntry = matches.at(-1)?.[1];
    if (relativeEntry === undefined || !JAVASCRIPT_ENTRY.test(relativeEntry)) return undefined;
    if (relativeEntry.split('\\').some((segment) => segment === '..' || segment === '.')) {
      return undefined;
    }

    const shimDirectory = win32.dirname(shimPath);
    const entryPath = win32.join(shimDirectory, relativeEntry);
    const insideShimDirectory = entryPath
      .toLowerCase()
      .startsWith(`${shimDirectory.toLowerCase()}${win32.sep}`);
    if (!insideShimDirectory || !this.fileSystem.isFile(entryPath)) return undefined;

    return { executablePath: this.nodeExecutablePath, prefixArgs: [entryPath] };
  }
}
