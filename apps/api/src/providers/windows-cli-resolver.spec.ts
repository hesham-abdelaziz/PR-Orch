import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NPM_NATIVE_EXE_SHIM,
  nativeExeShimTargeting,
} from '../../../../tests/fixtures/fake-clis/windows-npm-shims.js';
import {
  WindowsCliResolver,
  nodeFileSystem,
  type FileSystemPort,
} from './windows-cli-resolver.js';

const NPM_CODEX_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
].join('\r\n');

/**
 * Case-insensitive in-memory files. `links` maps a directory or file path to the
 * real path it resolves to (a junction or symbolic link).
 */
function memoryFileSystem(
  files: Record<string, string>,
  links: Record<string, string> = {},
): FileSystemPort {
  const normalized = new Map(
    Object.entries(files).map(([path, content]) => [path.toLowerCase(), content]),
  );
  const linkEntries = Object.entries(links);

  return {
    isFile: (path) => normalized.has(path.toLowerCase()),
    readText: (path) => normalized.get(path.toLowerCase()),
    realPath: (path) => {
      for (const [link, target] of linkEntries) {
        const lower = path.toLowerCase();
        const prefix = link.toLowerCase();
        if (lower === prefix || lower.startsWith(`${prefix}\\`)) {
          return `${target}${path.slice(link.length)}`;
        }
      }

      return path;
    },
  };
}

const NODE = 'C:\\Program Files\\nodejs\\node.exe';

function windowsResolver(
  files: Record<string, string>,
  pathValue: string,
  pathExt = '.COM;.EXE;.BAT;.CMD;.JS',
) {
  return new WindowsCliResolver({
    platform: 'win32',
    environment: { Path: pathValue, PATHEXT: pathExt },
    fileSystem: memoryFileSystem(files),
    nodeExecutablePath: NODE,
  });
}

describe('WindowsCliResolver', () => {
  it('finds a native executable by absolute path', () => {
    const resolver = windowsResolver(
      { 'C:\\Users\\me\\.local\\bin\\claude.exe': '' },
      'C:\\Windows\\System32;C:\\Users\\me\\.local\\bin',
    );

    expect(resolver.locate('claude')).toEqual({
      executablePath: 'C:\\Users\\me\\.local\\bin\\claude.exe',
      prefixArgs: [],
    });
  });

  it('lets the earliest PATH entry win for duplicate executables', () => {
    const resolver = windowsResolver(
      {
        'C:\\first\\claude.exe': '',
        'C:\\second\\claude.exe': '',
      },
      'C:\\first;C:\\second',
    );

    expect(resolver.locate('claude')?.executablePath).toBe('C:\\first\\claude.exe');
  });

  it('resolves an npm .cmd shim to node plus the package JavaScript entry point', () => {
    const resolver = windowsResolver(
      {
        'C:\\Users\\me\\AppData\\Roaming\\npm\\gemini.cmd': NPM_CODEX_SHIM.replace(
          /openai\\codex\\bin\\codex\.js/u,
          'google\\gemini-cli\\dist\\index.js',
        ).replace('@openai', '@google'),
        'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js':
          '',
      },
      'C:\\Users\\me\\AppData\\Roaming\\npm',
    );

    expect(resolver.locate('gemini')).toEqual({
      executablePath: NODE,
      prefixArgs: [
        'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js',
      ],
    });
  });

  it('prefers the native Codex executable over an npm shim found earlier on PATH', () => {
    const resolver = windowsResolver(
      {
        'C:\\npm\\codex.cmd': NPM_CODEX_SHIM,
        'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js': '',
        'C:\\tools\\codex.exe': '',
      },
      'C:\\npm;C:\\tools',
    );

    expect(resolver.locate('codex')).toEqual({
      executablePath: 'C:\\tools\\codex.exe',
      prefixArgs: [],
    });
  });

  it('falls back to the npm shim for Codex when no native executable exists', () => {
    const resolver = windowsResolver(
      {
        'C:\\npm\\codex.cmd': NPM_CODEX_SHIM,
        'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js': '',
      },
      'C:\\npm',
    );

    expect(resolver.locate('codex')).toEqual({
      executablePath: NODE,
      prefixArgs: ['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'],
    });
  });

  it('refuses a shim whose target escapes the shim directory', () => {
    const resolver = windowsResolver(
      {
        'C:\\npm\\claude.cmd':
          '@ECHO off\r\n"%_prog%"  "%dp0%\\..\\evil\\payload.js" %*',
        'C:\\evil\\payload.js': '',
      },
      'C:\\npm',
    );

    expect(resolver.locate('claude')).toBeUndefined();
  });

  it('refuses a shim that does not target a JavaScript file', () => {
    const resolver = windowsResolver(
      {
        'C:\\npm\\claude.cmd': '@ECHO off\r\n"%dp0%\\claude-helper.bat" %*',
        'C:\\npm\\claude-helper.bat': '',
      },
      'C:\\npm',
    );

    expect(resolver.locate('claude')).toBeUndefined();
  });

  it('refuses a shim whose JavaScript target does not exist', () => {
    const resolver = windowsResolver(
      { 'C:\\npm\\codex.cmd': NPM_CODEX_SHIM },
      'C:\\npm',
    );

    expect(resolver.locate('codex')).toBeUndefined();
  });

  it('ignores relative PATH entries, PowerShell scripts, and batch files', () => {
    const resolver = windowsResolver(
      {
        'C:\\work\\repo\\claude.exe': '',
        'C:\\ps\\claude.ps1': '',
        'C:\\bat\\claude.bat': '',
      },
      '.;bin;C:\\ps;C:\\bat',
    );

    expect(resolver.locate('claude')).toBeUndefined();
  });

  it('returns undefined when the command is missing', () => {
    const resolver = windowsResolver({}, 'C:\\Windows\\System32');

    expect(resolver.locate('gemini')).toBeUndefined();
  });

  it('finds executable files on POSIX platforms without any shell', () => {
    const resolver = new WindowsCliResolver({
      platform: 'linux',
      environment: { PATH: '/opt/none:/usr/local/bin' },
      fileSystem: memoryFileSystem({ '/usr/local/bin/codex': '' }),
      nodeExecutablePath: '/usr/bin/node',
    });

    expect(resolver.locate('codex')).toEqual({
      executablePath: '/usr/local/bin/codex',
      prefixArgs: [],
    });
  });
});

describe('WindowsCliResolver native npm launch targets', () => {
  const PREFIX = 'C:\\Program Files\\nodejs';
  const SHIM = `${PREFIX}\\claude.cmd`;
  const EXE = `${PREFIX}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;

  it('resolves the real Claude Code wrapper to its native executable without node', () => {
    const resolver = windowsResolver({ [SHIM]: NPM_NATIVE_EXE_SHIM, [EXE]: '' }, PREFIX);

    expect(resolver.locate('claude')).toEqual({ executablePath: EXE, prefixArgs: [] });
  });

  it('accepts a native target of an unscoped package', () => {
    const resolver = windowsResolver(
      {
        'C:\\npm\\tool.cmd': nativeExeShimTargeting('node_modules\\tool\\bin\\tool.exe'),
        'C:\\npm\\node_modules\\tool\\bin\\tool.exe': '',
      },
      'C:\\npm',
    );

    expect(resolver.locateExecutable('tool')).toEqual({
      executablePath: 'C:\\npm\\node_modules\\tool\\bin\\tool.exe',
      prefixArgs: [],
    });
  });

  it.each([
    ['a file beside the shim', 'claude-native.exe', `${PREFIX}\\claude-native.exe`],
    ['a directory outside node_modules', 'tools\\claude.exe', `${PREFIX}\\tools\\claude.exe`],
    ['node_modules itself, outside any package', 'node_modules\\claude.exe', `${PREFIX}\\node_modules\\claude.exe`],
    ['a bare scope, outside any package', 'node_modules\\@anthropic-ai\\claude.exe', `${PREFIX}\\node_modules\\@anthropic-ai\\claude.exe`],
    [
      '.. traversal out of the package',
      'node_modules\\@anthropic-ai\\claude-code\\..\\..\\..\\..\\..\\evil\\claude.exe',
      'C:\\evil\\claude.exe',
    ],
    [
      '.. traversal that lands back inside the package',
      'node_modules\\@anthropic-ai\\claude-code\\bin\\..\\bin\\claude.exe',
      EXE,
    ],
    ['a UNC target', '\\\\server\\share\\claude.exe', '\\\\server\\share\\claude.exe'],
    ['a drive-qualified target', 'C:\\evil\\claude.exe', 'C:\\evil\\claude.exe'],
    ['an alternate data stream', 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe:payload', EXE],
  ])('refuses a native target in %s', (_case, target, existing) => {
    const resolver = windowsResolver(
      { [SHIM]: nativeExeShimTargeting(target), [existing]: '', [EXE]: '' },
      PREFIX,
    );

    expect(resolver.locate('claude')).toBeUndefined();
  });

  it('refuses a native target that does not exist', () => {
    const resolver = windowsResolver({ [SHIM]: NPM_NATIVE_EXE_SHIM }, PREFIX);

    expect(resolver.locate('claude')).toBeUndefined();
  });

  it('refuses an absolute launch target that is not relative to the shim', () => {
    const resolver = windowsResolver(
      {
        [SHIM]: NPM_NATIVE_EXE_SHIM.replace('%dp0%\\node_modules', 'C:\\evil\\node_modules'),
        'C:\\evil\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe': '',
      },
      PREFIX,
    );

    expect(resolver.locate('claude')).toBeUndefined();
  });

  it('refuses a native wrapper found in a UNC PATH directory', () => {
    const share = '\\\\fileserver\\tools\\npm';
    const resolver = windowsResolver(
      {
        [`${share}\\claude.cmd`]: NPM_NATIVE_EXE_SHIM,
        [`${share}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`]: '',
      },
      share,
    );

    expect(resolver.locate('claude')).toBeUndefined();
  });

  it('refuses a package directory whose real path is outside the shim tree', () => {
    const resolver = new WindowsCliResolver({
      platform: 'win32',
      environment: { Path: PREFIX, PATHEXT: '.EXE;.CMD' },
      fileSystem: memoryFileSystem(
        { [SHIM]: NPM_NATIVE_EXE_SHIM, 'D:\\elsewhere\\bin\\claude.exe': '' },
        { [`${PREFIX}\\node_modules\\@anthropic-ai\\claude-code`]: 'D:\\elsewhere' },
      ),
      nodeExecutablePath: NODE,
    });

    expect(resolver.locate('claude')).toBeUndefined();
  });

  it('accepts a target whose real path differs only in letter case', () => {
    const resolver = new WindowsCliResolver({
      platform: 'win32',
      environment: { Path: PREFIX, PATHEXT: '.EXE;.CMD' },
      fileSystem: memoryFileSystem(
        { [SHIM]: NPM_NATIVE_EXE_SHIM, [EXE]: '' },
        { [PREFIX]: PREFIX.toUpperCase() },
      ),
      nodeExecutablePath: NODE,
    });

    expect(resolver.locate('claude')).toEqual({
      executablePath: EXE.replace(PREFIX, PREFIX.toUpperCase()),
      prefixArgs: [],
    });
  });

  it('keeps preferring a native Codex executable on PATH over a native-target shim found earlier', () => {
    const resolver = windowsResolver(
      {
        'C:\\npm\\codex.cmd': nativeExeShimTargeting('node_modules\\@openai\\codex\\bin\\codex.exe'),
        'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.exe': '',
        'C:\\tools\\codex.exe': '',
      },
      'C:\\npm;C:\\tools',
    );

    // Both are native (no Node prefix), so PATH order decides, as for any native pair.
    expect(resolver.locate('codex')).toEqual({
      executablePath: 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.exe',
      prefixArgs: [],
    });
  });
});

/** Symbolic links to files need a privilege on Windows; skip where it is missing. */
async function trySymlink(target: string, path: string, type: 'file' | 'junction'): Promise<boolean> {
  try {
    await symlink(target, path, type);

    return true;
  } catch {
    return false;
  }
}

describe.runIf(process.platform === 'win32')('WindowsCliResolver on the real Windows filesystem', () => {
  async function layout() {
    const base = await mkdtemp(join(tmpdir(), 'cli-resolver-'));
    const prefix = join(base, 'prefix');
    const packageDirectory = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code');
    const outside = join(base, 'outside');
    await mkdir(join(packageDirectory, 'bin'), { recursive: true });
    await mkdir(join(outside, 'bin'), { recursive: true });
    await writeFile(join(prefix, 'claude.cmd'), NPM_NATIVE_EXE_SHIM);
    await writeFile(join(outside, 'bin', 'claude.exe'), '');
    const resolver = new WindowsCliResolver({
      environment: { Path: prefix, PATHEXT: '.EXE;.CMD' },
      fileSystem: nodeFileSystem,
      nodeExecutablePath: NODE,
    });

    return { base, prefix, packageDirectory, outside, resolver };
  }

  it('resolves a native target that is a regular file inside the package', async () => {
    const { base, packageDirectory, resolver } = await layout();
    try {
      const exe = join(packageDirectory, 'bin', 'claude.exe');
      await writeFile(exe, '');

      expect(resolver.locate('claude')).toEqual({ executablePath: exe, prefixArgs: [] });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('refuses a native target that is a directory', async () => {
    const { base, packageDirectory, resolver } = await layout();
    try {
      await mkdir(join(packageDirectory, 'bin', 'claude.exe'));

      expect(resolver.locate('claude')).toBeUndefined();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('refuses a package directory junctioned outside the shim tree', async () => {
    const { base, prefix, outside, resolver } = await layout();
    try {
      const scope = join(prefix, 'node_modules', '@anthropic-ai');
      await rm(join(scope, 'claude-code'), { recursive: true, force: true });
      await symlink(outside, join(scope, 'claude-code'), 'junction');

      expect(resolver.locate('claude')).toBeUndefined();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it('refuses an executable symlinked outside the shim tree', async (context) => {
    const { base, packageDirectory, outside, resolver } = await layout();
    try {
      const linked = await trySymlink(
        join(outside, 'bin', 'claude.exe'),
        join(packageDirectory, 'bin', 'claude.exe'),
        'file',
      );
      if (!linked) context.skip('creating file symbolic links needs the Windows symlink privilege');

      expect(resolver.locate('claude')).toBeUndefined();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
