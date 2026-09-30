import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

export type TaskkillRunner = (
  executable: string,
  args: readonly string[],
) => Promise<void>;

export interface ProcessTreeKillerOptions {
  platform?: NodeJS.Platform;
  /** Delay between the polite request and forced termination. */
  graceMs?: number;
  /** Overrides `%SystemRoot%`; used to build the absolute taskkill path. */
  systemRoot?: string;
  /** Replaceable so command construction is testable without Windows. */
  runTaskkill?: TaskkillRunner;
}

const POLL_INTERVAL_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTaskkillProcess(
  executable: string,
  args: readonly string[],
): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    // taskkill exits non-zero when the target is already gone; that is fine.
    child.once('error', () => resolve());
    child.once('close', () => resolve());
  });
}

/**
 * Terminates a process and all of its descendants.
 *
 * - Windows: `taskkill /PID <pid> /T` (polite), then `/T /F` after the grace
 *   period. The executable is addressed by absolute path and never via a shell.
 * - POSIX: children are spawned in their own process group, so the whole group
 *   receives SIGTERM and then SIGKILL.
 *
 * Calls are idempotent per pid: concurrent callers share one termination.
 */
export class ProcessTreeKiller {
  private readonly platform: NodeJS.Platform;
  private readonly graceMs: number;
  private readonly systemRoot: string;
  private readonly runTaskkill: TaskkillRunner;
  private readonly inFlight = new Map<number, Promise<void>>();

  constructor(options: ProcessTreeKillerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.graceMs = options.graceMs ?? 2_000;
    this.systemRoot =
      options.systemRoot ??
      process.env['SystemRoot'] ??
      process.env['SYSTEMROOT'] ??
      'C:\\Windows';
    this.runTaskkill = options.runTaskkill ?? runTaskkillProcess;
  }

  terminate(pid: number, hasExited: () => boolean): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) {
      return Promise.reject(new Error(`Invalid pid for termination: ${pid}`));
    }

    const existing = this.inFlight.get(pid);
    if (existing) return existing;

    const termination = (
      this.platform === 'win32'
        ? this.terminateWindows(pid, hasExited)
        : this.terminatePosix(pid)
    ).finally(() => {
      this.inFlight.delete(pid);
    });
    this.inFlight.set(pid, termination);

    return termination;
  }

  /**
   * Best-effort cleanup of stragglers after the root process exited normally.
   * Only possible on POSIX, where the process group outlives its leader.
   */
  killRemainingDescendants(pid: number): void {
    if (this.platform === 'win32') return;
    this.signalGroup(pid, 'SIGKILL');
  }

  private get taskkillPath(): string {
    return win32.join(this.systemRoot, 'System32', 'taskkill.exe');
  }

  private async terminateWindows(
    pid: number,
    hasExited: () => boolean,
  ): Promise<void> {
    const pidText = String(pid);

    await this.safely(() =>
      this.runTaskkill(this.taskkillPath, ['/PID', pidText, '/T']),
    );
    await this.waitUntil(hasExited, this.graceMs);

    if (!hasExited()) {
      await this.safely(() =>
        this.runTaskkill(this.taskkillPath, ['/PID', pidText, '/T', '/F']),
      );
    }
  }

  private async terminatePosix(pid: number): Promise<void> {
    this.signalGroup(pid, 'SIGTERM');
    await this.waitUntil(() => !this.groupExists(pid), this.graceMs);
    // Descendants may ignore SIGTERM even after the leader exited.
    this.signalGroup(pid, 'SIGKILL');
  }

  private signalGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Already gone.
      }
    }
  }

  private groupExists(pid: number): boolean {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async waitUntil(
    condition: () => boolean,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (!condition() && Date.now() < deadline) {
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
    }
  }

  private async safely(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch {
      // The target may already have exited; termination is best effort.
    }
  }
}
