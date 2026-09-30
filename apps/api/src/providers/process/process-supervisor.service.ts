import { spawn, type ChildProcess } from 'node:child_process';
import { isAbsolute, extname } from 'node:path';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { OutputBuffer } from './output-buffer.js';
import {
  PROCESS_SUPERVISOR_OPTIONS,
  type ProcessRunBase,
  type ProcessRunRequest,
  type ProcessRunResult,
  type ProcessSpawnError,
  type ProcessSupervisorOptions,
} from './process-runner.types.js';
import { ProcessTreeKiller } from './process-tree-killer.js';

type TerminationReason = 'timed_out' | 'cancelled';

interface ActiveRun {
  child: ChildProcess | null;
  reason: TerminationReason | null;
  exited: boolean;
  terminate: (reason: TerminationReason) => Promise<void>;
  settled: Promise<ProcessRunResult>;
}

const BATCH_EXTENSIONS = new Set(['.cmd', '.bat']);
const DEFAULT_FORCE_RESOLVE_MS = 5_000;

@Injectable()
export class ProcessSupervisor {
  private readonly active = new Map<string, ActiveRun>();
  private readonly killer: ProcessTreeKiller;
  private readonly forceResolveMs: number;

  constructor(
    @Optional()
    @Inject(PROCESS_SUPERVISOR_OPTIONS)
    options: ProcessSupervisorOptions = {},
  ) {
    this.killer = new ProcessTreeKiller(
      options.terminationGraceMs === undefined
        ? {}
        : { graceMs: options.terminationGraceMs },
    );
    this.forceResolveMs = options.forceResolveMs ?? DEFAULT_FORCE_RESOLVE_MS;
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.validate(request);

    const startedAt = Date.now();
    const stdout = new OutputBuffer(request.maxStdoutBytes);
    const stderr = new OutputBuffer(request.maxStderrBytes);
    const snapshot = (): ProcessRunBase => ({
      runId: request.runId,
      stdout: stdout.toSanitizedString(),
      stderr: stderr.toSanitizedString(),
      stdoutBytes: stdout.totalBytes,
      stderrBytes: stderr.totalBytes,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      durationMs: Date.now() - startedAt,
    });

    if (request.signal.aborted) {
      return { ...snapshot(), status: 'cancelled' };
    }

    const run: ActiveRun = {
      child: null,
      reason: null,
      exited: false,
      terminate: () => Promise.resolve(),
      settled: Promise.resolve(undefined as never),
    };
    this.active.set(request.runId, run);

    run.settled = new Promise<ProcessRunResult>((resolve) => {
      let finished = false;
      let timeout: NodeJS.Timeout | undefined;
      let forceResolve: NodeJS.Timeout | undefined;
      let termination: Promise<void> | null = null;

      const onAbort = (): void => {
        void run.terminate('cancelled');
      };

      const classify = (
        base: ProcessRunBase,
        exitCode: number | null,
        signal: NodeJS.Signals | null,
        error?: ProcessSpawnError,
      ): ProcessRunResult => {
        if (run.reason === 'timed_out') return { ...base, status: 'timed_out' };
        if (run.reason === 'cancelled') return { ...base, status: 'cancelled' };
        if (exitCode === 0 && !error) {
          return { ...base, status: 'completed', exitCode: 0 };
        }

        return {
          ...base,
          status: 'failed',
          exitCode,
          signal,
          ...(error ? { error } : {}),
        };
      };

      const finish = (
        exitCode: number | null,
        signal: NodeJS.Signals | null,
        error?: ProcessSpawnError,
      ): void => {
        if (finished) return;
        finished = true;
        if (timeout) clearTimeout(timeout);
        if (forceResolve) clearTimeout(forceResolve);
        request.signal.removeEventListener('abort', onAbort);
        this.active.delete(request.runId);
        resolve(classify(snapshot(), exitCode, signal, error));
      };

      run.terminate = (reason: TerminationReason): Promise<void> => {
        // Terminal state is decided once: the first reason wins, and a process
        // that already exited on its own keeps its natural outcome.
        if (run.exited || finished) return termination ?? Promise.resolve();
        run.reason ??= reason;

        const pid = run.child?.pid;
        if (pid === undefined) {
          finish(null, null);
          return Promise.resolve();
        }

        termination ??= this.killer
          .terminate(pid, () => run.exited)
          .catch(() => undefined)
          .then(() => {
            // Pipes held open by an unkillable descendant must not hang us.
            forceResolve = setTimeout(() => finish(null, null), this.forceResolveMs);
            forceResolve.unref();
          });

        return termination;
      };

      let child: ChildProcess;
      try {
        child = spawn(request.executablePath, [...request.args], {
          cwd: request.cwd,
          env: { ...request.environment },
          shell: false,
          windowsHide: true,
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        finish(null, null, toSpawnError(error));
        return;
      }
      run.child = child;

      child.once('error', (error) => {
        // Spawn failures never produce a pid; later runtime errors follow an exit.
        if (child.pid === undefined) finish(null, null, toSpawnError(error));
      });
      child.stdout?.on('data', (chunk: Buffer) => stdout.append(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk));
      child.stdin?.on('error', () => undefined); // EPIPE when the child exits early
      child.stdin?.end(request.stdin, 'utf8');

      child.once('exit', () => {
        run.exited = true;
        if (child.pid !== undefined) {
          this.killer.killRemainingDescendants(child.pid);
        }
      });
      child.once('close', (code, signal) => {
        run.exited = true;
        finish(code, signal);
      });

      request.signal.addEventListener('abort', onAbort, { once: true });
      timeout = setTimeout(() => {
        void run.terminate('timed_out');
      }, request.timeoutMs);
    });

    return run.settled;
  }

  async cancel(runId: string): Promise<void> {
    const run = this.active.get(runId);
    if (!run) return;

    await run.terminate('cancelled');
    await run.settled;
  }

  private validate(request: ProcessRunRequest): void {
    if (request.runId.trim().length === 0) {
      throw new Error('runId is required');
    }
    if (this.active.has(request.runId)) {
      throw new Error(`Run ${request.runId} is already active`);
    }
    if (!isAbsolute(request.executablePath)) {
      throw new Error('executablePath must be absolute');
    }
    if (BATCH_EXTENSIONS.has(extname(request.executablePath).toLowerCase())) {
      throw new Error(
        'Batch files cannot be spawned without a shell; resolve the shim to its script entry point',
      );
    }
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0) {
      throw new Error('timeoutMs must be a positive number');
    }
    if (request.maxStdoutBytes <= 0 || request.maxStderrBytes <= 0) {
      throw new Error('Output byte limits must be positive');
    }
  }
}

function toSpawnError(error: unknown): ProcessSpawnError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : 'SPAWN_FAILED';
  const message = error instanceof Error ? error.message : String(error);

  return { code, message };
}
