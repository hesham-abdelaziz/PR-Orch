import { describe, expect, it } from 'vitest';

import { ProcessTreeKiller } from './process-tree-killer.js';

function windowsKiller(exitedAfterFirstCall: boolean) {
  const calls: Array<{ executable: string; args: readonly string[] }> = [];
  let exited = false;
  const killer = new ProcessTreeKiller({
    platform: 'win32',
    graceMs: 20,
    systemRoot: 'C:\\Windows',
    runTaskkill: async (executable, args) => {
      calls.push({ executable, args });
      if (exitedAfterFirstCall) exited = true;
    },
  });

  return { killer, calls, hasExited: () => exited };
}

describe('ProcessTreeKiller (win32 command construction)', () => {
  it('asks politely first, then force-kills the whole tree by absolute taskkill path', async () => {
    const { killer, calls, hasExited } = windowsKiller(false);

    await killer.terminate(4321, hasExited);

    expect(calls).toEqual([
      {
        executable: 'C:\\Windows\\System32\\taskkill.exe',
        args: ['/PID', '4321', '/T'],
      },
      {
        executable: 'C:\\Windows\\System32\\taskkill.exe',
        args: ['/PID', '4321', '/T', '/F'],
      },
    ]);
  });

  it('skips the forced kill when the process exits during the grace period', async () => {
    const { killer, calls, hasExited } = windowsKiller(true);

    await killer.terminate(4321, hasExited);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['/PID', '4321', '/T']);
  });

  it('is idempotent per pid while a termination is in flight', async () => {
    const { killer, calls, hasExited } = windowsKiller(false);

    await Promise.all([
      killer.terminate(99, hasExited),
      killer.terminate(99, hasExited),
      killer.terminate(99, hasExited),
    ]);

    expect(calls).toHaveLength(2);
  });

  it('rejects non-integer or non-positive pids', async () => {
    const { killer, hasExited } = windowsKiller(false);

    await expect(killer.terminate(0, hasExited)).rejects.toThrow(/pid/i);
    await expect(killer.terminate(-4, hasExited)).rejects.toThrow(/pid/i);
    await expect(killer.terminate(1.5, hasExited)).rejects.toThrow(/pid/i);
  });

  it('swallows taskkill failures because the process may already be gone', async () => {
    const killer = new ProcessTreeKiller({
      platform: 'win32',
      graceMs: 10,
      systemRoot: 'C:\\Windows',
      runTaskkill: async () => {
        throw new Error('taskkill exited with 128');
      },
    });

    await expect(killer.terminate(7, () => false)).resolves.toBeUndefined();
  });
});
