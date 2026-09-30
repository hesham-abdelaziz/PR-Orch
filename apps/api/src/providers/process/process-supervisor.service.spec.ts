import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  fakeCliCommand,
  isProcessAlive,
  waitFor,
} from '../../../../../tests/fixtures/fake-clis/scenarios.js';
import { buildChildEnvironment } from './environment-policy.js';
import type { ProcessRunRequest } from './process-runner.types.js';
import { ProcessSupervisor } from './process-supervisor.service.js';

const cwd = process.cwd();

function baseRequest(
  runId: string,
  scenario: Parameters<typeof fakeCliCommand>[0],
  scenarioArgs: readonly string[] = [],
  overrides: Partial<ProcessRunRequest> = {},
): ProcessRunRequest {
  const command = fakeCliCommand(scenario, scenarioArgs);

  return {
    runId,
    executablePath: command.executablePath,
    args: command.args,
    cwd,
    stdin: '',
    timeoutMs: 15_000,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 64 * 1024,
    environment: buildChildEnvironment({ parent: process.env }),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('ProcessSupervisor', () => {
  const supervisor = new ProcessSupervisor({ terminationGraceMs: 150 });
  const leakedPids: number[] = [];

  afterEach(() => {
    for (const pid of leakedPids.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });

  it('captures stdout and stderr separately and reports a completed run', async () => {
    const result = await supervisor.run(baseRequest('run-stderr', 'stderr'));

    expect(result.status).toBe('completed');
    expect(result.stdout).toBe('stdout-line\n');
    expect(result.stderr).toBe('stderr-line\n');
    expect(result.stdoutTruncated).toBe(false);
    expect(result.stderrTruncated).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('delivers the prompt through stdin', async () => {
    const result = await supervisor.run(
      baseRequest('run-stdin', 'echo-stdin', [], {
        stdin: 'prompt with "quotes" and ünïcode ✓',
      }),
    );

    expect(result.status).toBe('completed');
    expect(JSON.parse(result.stdout)).toEqual({
      stdin: 'prompt with "quotes" and ünïcode ✓',
    });
  });

  it('passes arguments verbatim without shell interpretation', async () => {
    const hostile = '; echo pwned && whoami | cat';
    const result = await supervisor.run(
      baseRequest('run-args', 'print-args', [hostile, '$(id)', '%PATH%']),
    );

    expect(result.status).toBe('completed');
    const printed = JSON.parse(result.stdout) as string[];
    expect(printed.slice(-3)).toEqual([hostile, '$(id)', '%PATH%']);
  });

  it('gives the child only the supplied environment', async () => {
    process.env['LEAK_TEST_SECRET'] = 'should-not-leak';
    try {
      const result = await supervisor.run(baseRequest('run-env', 'print-env'));

      expect(result.status).toBe('completed');
      expect(result.stdout).not.toContain('should-not-leak');
      expect(Object.keys(JSON.parse(result.stdout) as object)).not.toContain(
        'LEAK_TEST_SECRET',
      );
    } finally {
      delete process.env['LEAK_TEST_SECRET'];
    }
  });

  it('reports a failed run with the exit code and keeps stderr', async () => {
    const result = await supervisor.run(baseRequest('run-auth', 'auth-failure'));

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.exitCode).toBe(41);
    expect(result.stderr).toContain('not authenticated');
  });

  it('reports a spawn failure as failed without throwing', async () => {
    const result = await supervisor.run({
      ...baseRequest('run-missing', 'success'),
      executablePath: `${process.execPath}-does-not-exist`,
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.exitCode).toBeNull();
    expect(result.error?.code).toBe('ENOENT');
  });

  it('rejects relative executables, batch files, and duplicate run ids', async () => {
    await expect(
      supervisor.run({ ...baseRequest('rel', 'success'), executablePath: 'node' }),
    ).rejects.toThrow(/absolute/i);
    await expect(
      supervisor.run({
        ...baseRequest('bat', 'success'),
        executablePath: process.platform === 'win32' ? 'C:\\tools\\x.cmd' : '/tmp/x.cmd',
      }),
    ).rejects.toThrow(/batch/i);

    const first = supervisor.run(baseRequest('dup', 'hang'));
    await expect(supervisor.run(baseRequest('dup', 'hang'))).rejects.toThrow(
      /already/i,
    );
    await supervisor.cancel('dup');
    await first;
  });

  it('times out a hung process and reports timed_out', async () => {
    const started = Date.now();
    const result = await supervisor.run(
      baseRequest('run-timeout', 'hang', ['--ignore-sigterm'], { timeoutMs: 300 }),
    );

    expect(result.status).toBe('timed_out');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.stdout).toContain('hang-started');
  });

  it('cancels explicitly, idempotently, and ignores unknown run ids', async () => {
    const running = supervisor.run(
      baseRequest('run-cancel', 'hang', ['--ignore-sigterm']),
    );
    await waitFor(() => supervisor.isActive('run-cancel'));

    await Promise.all([
      supervisor.cancel('run-cancel'),
      supervisor.cancel('run-cancel'),
    ]);
    const result = await running;

    expect(result.status).toBe('cancelled');
    await expect(supervisor.cancel('run-cancel')).resolves.toBeUndefined();
    await expect(supervisor.cancel('never-existed')).resolves.toBeUndefined();
  });

  it('cancels when the abort signal fires', async () => {
    const controller = new AbortController();
    const running = supervisor.run(
      baseRequest('run-abort', 'hang', [], { signal: controller.signal }),
    );
    await waitFor(() => supervisor.isActive('run-abort'));

    controller.abort();

    expect((await running).status).toBe('cancelled');
  });

  it('returns cancelled without spawning when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await supervisor.run(
      baseRequest('run-preaborted', 'success', [], { signal: controller.signal }),
    );

    expect(result.status).toBe('cancelled');
    expect(result.stdout).toBe('');
  });

  it('terminates ignoring-SIGTERM descendants when cancelling', async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'fake-cli-')), 'child.pid');
    const running = supervisor.run(
      baseRequest('run-tree-cancel', 'spawn-child', [`--pid-file=${pidFile}`]),
    );
    const childPid = await waitForPidFile(pidFile);
    leakedPids.push(childPid);
    expect(isProcessAlive(childPid)).toBe(true);

    await supervisor.cancel('run-tree-cancel');
    const result = await running;

    expect(result.status).toBe('cancelled');
    await waitFor(() => !isProcessAlive(childPid), 5_000);
    expect(isProcessAlive(childPid)).toBe(false);
  });

  it('terminates descendants when the timeout fires', async () => {
    const result = await supervisor.run(
      baseRequest('run-tree-timeout', 'spawn-child', [], { timeoutMs: 600 }),
    );
    const match = /child-pid:(\d+)/.exec(result.stdout);
    expect(match).not.toBeNull();
    const childPid = Number(match?.[1]);
    leakedPids.push(childPid);

    expect(result.status).toBe('timed_out');
    await waitFor(() => !isProcessAlive(childPid), 5_000);
    expect(isProcessAlive(childPid)).toBe(false);
  });

  it('strips ANSI escape sequences from captured output', async () => {
    const result = await supervisor.run(baseRequest('run-ansi', 'ansi'));

    expect(result.status).toBe('completed');
    expect(result.stdout).toBe('red text\nprogress done\n');
    expect(result.stderr).toBe('warn\n');
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const result = await supervisor.run(baseRequest('run-utf8', 'utf8-split'));

    expect(result.status).toBe('completed');
    expect(result.stdout).toBe('héllo €uro 😀\n');
    expect(result.stdout).not.toContain('\uFFFD');
  });

  it('caps stdout and stderr independently while continuing to drain both', async () => {
    const result = await supervisor.run(
      baseRequest(
        'run-oversized',
        'oversized',
        ['--stdout-bytes=600000', '--stderr-bytes=50'],
        { maxStdoutBytes: 1_000, maxStderrBytes: 4_096, timeoutMs: 20_000 },
      ),
    );

    expect(result.status).toBe('completed');
    expect(result.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(1_000);
    expect(result.stdoutBytes).toBe(600_000);
    expect(result.stderrTruncated).toBe(false);
    expect(result.stderrBytes).toBe(50);
  });

  it('caps stderr without truncating a small stdout', async () => {
    const result = await supervisor.run(
      baseRequest(
        'run-oversized-err',
        'oversized',
        ['--stdout-bytes=10', '--stderr-bytes=300000'],
        { maxStdoutBytes: 4_096, maxStderrBytes: 500, timeoutMs: 20_000 },
      ),
    );

    expect(result.status).toBe('completed');
    expect(result.stdoutTruncated).toBe(false);
    expect(result.stderrTruncated).toBe(true);
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(500);
  });

  it('does not leave a truncated multi-byte character behind', async () => {
    const result = await supervisor.run(
      baseRequest('run-trunc-utf8', 'utf8-flood', [], {
        maxStdoutBytes: 1_001,
      }),
    );

    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout).not.toContain('\uFFFD');
  });
});

async function waitForPidFile(pidFile: string): Promise<number> {
  let pid: number | undefined;
  await waitFor(() => {
    try {
      const parsed = Number(readFileSync(pidFile, 'utf8').trim());
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    } catch {
      pid = undefined;
    }
    return pid !== undefined;
  }, 5_000);

  return pid as number;
}
