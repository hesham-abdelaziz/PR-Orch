export interface ProcessRunRequest {
  runId: string;
  executablePath: string;
  args: readonly string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  environment: Readonly<Record<string, string>>;
  signal: AbortSignal;
}

export interface ProcessRunBase {
  runId: string;
  /** ANSI-stripped, UTF-8 decoded, capped at `maxStdoutBytes` raw bytes. */
  stdout: string;
  /** ANSI-stripped, UTF-8 decoded, capped at `maxStderrBytes` raw bytes. */
  stderr: string;
  /** Total bytes the child wrote to stdout, including bytes that were discarded. */
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
}

export interface ProcessSpawnError {
  code: string;
  message: string;
}

export type ProcessRunResult =
  | (ProcessRunBase & { status: 'completed'; exitCode: 0 })
  | (ProcessRunBase & {
      status: 'failed';
      exitCode: number | null;
      signal: string | null;
      error?: ProcessSpawnError;
    })
  | (ProcessRunBase & { status: 'timed_out' })
  | (ProcessRunBase & { status: 'cancelled' });

export type ProcessRunStatus = ProcessRunResult['status'];

export interface ProcessSupervisorOptions {
  /** Time between the polite termination request and forced termination. */
  terminationGraceMs?: number;
  /** Upper bound to wait for pipes to close after forced termination. */
  forceResolveMs?: number;
}

export const PROCESS_SUPERVISOR_OPTIONS = Symbol('PROCESS_SUPERVISOR_OPTIONS');
