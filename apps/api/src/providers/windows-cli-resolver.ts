import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

import type { ProviderId } from '@pr-orchestrator/contracts';

import type { CliLocator, ResolvedExecutable } from './provider-adapter.js';

export interface FileSystemPort {
  /** True for an existing regular file (links are followed). */
  isFile(path: string): boolean;
  readText(path: string): string | undefined;
  /**
   * Canonical path with every junction and symbolic link resolved, or
   * `undefined` when it cannot be resolved. Ports without links may omit it.
   */
  realPath?(path: string): string | undefined;
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
  realPath(path) {
    try {
      return realpathSync.native(path);
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
const NATIVE_ENTRY = /\.exe$/iu;
// A package directory name: `name` or the `name` half of `@scope\name`.
const PACKAGE_SEGMENT = /^[^@\\/:*?"<>|][^\\/:*?"<>|]*$/u;
const SCOPE_SEGMENT = /^@[^\\/:*?"<>|]+$/u;

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
    const excluded = this.appManagedRoots();

    return raw
      .split(this.pathApi.delimiter)
      .map((entry) => entry.trim().replace(/^"(.*)"$/u, '$1'))
      .filter((entry) => entry.length > 0 && this.pathApi.isAbsolute(entry))
      .filter((entry) => !excluded.some((root) => this.isWithin(entry, root)));
  }

  /**
   * Directories whose executables are private copies managed by another app,
   * never a user's CLI installation. The Codex desktop app keeps state and
   * helper binaries under its home (CODEX_HOME, default `~/.codex`), e.g. the
   * stale sandbox copy `.sandbox-bin\codex.exe`, and prepends such folders to
   * PATH for processes it launches. A backend started from there must still
   * run the user's installed, detected CLI rather than those copies.
   */
  private appManagedRoots(): string[] {
    const configured = this.environmentValue('CODEX_HOME');
    const home = this.isWindows
      ? this.environmentValue('USERPROFILE') ?? this.environmentValue('HOME')
      : this.environmentValue('HOME');
    const codexHome =
      configured !== undefined && configured.trim().length > 0
        ? configured.trim()
        : home === undefined
          ? undefined
          : this.pathApi.join(home, '.codex');

    return codexHome !== undefined && this.pathApi.isAbsolute(codexHome) ? [codexHome] : [];
  }

  private isWithin(directory: string, root: string): boolean {
    const normalize = (value: string) => {
      const resolved = this.pathApi.resolve(value).replace(/[\\/]+$/u, '');

      return this.isWindows ? resolved.toLowerCase() : resolved;
    };
    const candidate = normalize(directory);
    const base = normalize(root);

    return candidate === base || candidate.startsWith(`${base}${this.pathApi.sep}`);
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
    if (relativeEntry === undefined) return undefined;
    if (NATIVE_ENTRY.test(relativeEntry)) return this.resolveNativeShimTarget(shimPath, relativeEntry);
    if (!JAVASCRIPT_ENTRY.test(relativeEntry)) return undefined;
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

  /**
   * npm launches a native `bin` (e.g. Claude Code's `claude.exe`) directly from
   * its wrapper. The target is accepted only when it is a regular file whose
   * real path stays under `<shim dir>\node_modules\<package>\`; it is then run
   * as itself, without Node.
   */
  private resolveNativeShimTarget(
    shimPath: string,
    relativeEntry: string,
  ): ResolvedExecutable | undefined {
    const segments = relativeEntry.split('\\');
    const cleanSegments = segments.every(
      (segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':'),
    );
    if (!cleanSegments || segments[0]?.toLowerCase() !== 'node_modules') return undefined;

    const scoped = segments[1]?.startsWith('@') === true;
    const packageSegments = scoped ? segments.slice(1, 3) : segments.slice(1, 2);
    const validPackage = scoped
      ? SCOPE_SEGMENT.test(packageSegments[0] ?? '') && PACKAGE_SEGMENT.test(packageSegments[1] ?? '')
      : PACKAGE_SEGMENT.test(packageSegments[0] ?? '');
    // At least one segment (the executable) must follow the package directory.
    if (!validPackage || segments.length <= 1 + packageSegments.length) return undefined;

    const shimDirectory = win32.dirname(shimPath);
    if (!win32.isAbsolute(shimDirectory) || isUncPath(shimDirectory)) return undefined;

    // Containment is checked on real paths: the target, after every junction and
    // link is resolved, must sit under the real shim directory's package folder.
    const realShimDirectory = this.realPath(shimDirectory);
    const realEntry = this.realPath(win32.join(shimDirectory, ...segments));
    if (realShimDirectory === undefined || realEntry === undefined) return undefined;
    if (!win32.isAbsolute(realEntry) || isUncPath(realShimDirectory) || isUncPath(realEntry)) {
      return undefined;
    }

    const packageRoot = win32.join(realShimDirectory, 'node_modules', ...packageSegments);
    const insidePackage = realEntry
      .toLowerCase()
      .startsWith(`${packageRoot.toLowerCase()}${win32.sep}`);
    if (!insidePackage || !this.fileSystem.isFile(realEntry)) return undefined;

    return { executablePath: realEntry, prefixArgs: [] };
  }

  private realPath(path: string): string | undefined {
    return this.fileSystem.realPath ? this.fileSystem.realPath(path) : path;
  }
}

/** `\\server\share`, `\\?\…` and `\\.\…` forms; never trusted as a launch location. */
function isUncPath(path: string): boolean {
  return path.startsWith('\\\\') || path.startsWith('//');
}
