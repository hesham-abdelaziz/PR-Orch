/**
 * Synthetic copies of the `.cmd` wrappers npm writes into its global prefix on
 * Windows. Only the launcher shape matters; no paths, users or secrets from a
 * real machine are embedded. Lines are CRLF-joined like the real files.
 */

/**
 * Wrapper for a package whose `bin` is a native executable: the line shape of
 * the installed Claude Code 2.1.280 `claude.cmd` (read as text from the npm
 * global prefix on Windows), including the three spaces before `%*`. npm
 * launches the target directly instead of through node.
 */
export const NPM_NATIVE_EXE_SHIM_LINES = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*',
] as const;

export const NPM_NATIVE_EXE_SHIM = `${NPM_NATIVE_EXE_SHIM_LINES.join('\r\n')}\r\n`;

/** Relative launch target inside the native-exe wrapper above. */
export const NPM_NATIVE_EXE_TARGET = 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';

/** Rewrites the native wrapper's launch target, keeping the rest of its shape. */
export function nativeExeShimTargeting(relativeTarget: string): string {
  return NPM_NATIVE_EXE_SHIM.replace(NPM_NATIVE_EXE_TARGET, relativeTarget);
}
