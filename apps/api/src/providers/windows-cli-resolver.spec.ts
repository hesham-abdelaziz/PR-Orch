import { describe, expect, it } from 'vitest';

import {
  WindowsCliResolver,
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

function memoryFileSystem(files: Record<string, string>): FileSystemPort {
  const normalized = new Map(
    Object.entries(files).map(([path, content]) => [path.toLowerCase(), content]),
  );

  return {
    isFile: (path) => normalized.has(path.toLowerCase()),
    readText: (path) => normalized.get(path.toLowerCase()),
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
