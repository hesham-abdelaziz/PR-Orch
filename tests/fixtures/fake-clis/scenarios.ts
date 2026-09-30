import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FAKE_CLI_SCENARIOS = [
  'success',
  'stderr',
  'malformed',
  'hang',
  'spawn-child',
  'oversized',
  'auth-failure',
  'exit',
  'echo-stdin',
  'print-args',
  'print-env',
  'ansi',
  'utf8-split',
  'utf8-flood',
] as const;

export type FakeCliScenario = (typeof FAKE_CLI_SCENARIOS)[number];

export const FAKE_CLI_PATH = fileURLToPath(
  new URL('./fake-cli.mjs', import.meta.url),
);

export interface FakeCliCommand {
  /** Absolute path of the Node binary; the fake CLI is its script argument. */
  executablePath: string;
  args: string[];
}

/** Builds an absolute-path, argument-array command for a fake CLI scenario. */
export function fakeCliCommand(
  scenario: FakeCliScenario,
  extraArgs: readonly string[] = [],
): FakeCliCommand {
  return {
    executablePath: process.execPath,
    args: [FAKE_CLI_PATH, `--scenario=${scenario}`, ...extraArgs],
  };
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // A zombie has terminated; it only awaits reaping by its parent.
      return !/^\d+ \(.*\) [ZX]/su.test(stat);
    } catch {
      return false;
    }
  }

  return true;
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
  intervalMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
