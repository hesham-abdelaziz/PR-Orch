import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

export type FakeProviderName = 'claude' | 'codex' | 'gemini';

export interface FakeProviderBehavior {
  version?: string;
  authenticated?: boolean;
  run?:
    | 'success'
    | 'malformed'
    | 'malformed-once'
    | 'auth-failure'
    | 'model-not-found'
    | 'leak-secret'
    | 'error-envelope'
    | 'hang'
    | 'spawn-child';
  /** JSONL file that records argv, stdin, cwd, and environment of every run. */
  logFile?: string;
  /** Counts run invocations, enabling first-call-only behaviors. */
  counterFile?: string;
  pidFile?: string;
  secret?: string;
  badModel?: string;
  help?: Partial<Record<FakeProviderName | 'codex-exec', string>>;
}

export const FAKE_PROVIDER_MODULE_URL = new URL(
  './fake-provider.mjs',
  import.meta.url,
).href;

/**
 * Writes a wrapper script that behaves like the named provider CLI. Run it
 * with `process.execPath` as the executable and the returned path as the first
 * argument, exactly how the resolver launches npm-installed CLIs.
 */
export function writeFakeProviderScript(
  directory: string,
  provider: FakeProviderName,
  behavior: FakeProviderBehavior = {},
): string {
  const scriptPath = `${directory}/fake-${provider}-${Math.random().toString(36).slice(2, 8)}.mjs`;
  const source = [
    `import { main } from ${JSON.stringify(FAKE_PROVIDER_MODULE_URL)};`,
    `await main(${JSON.stringify(provider)}, ${JSON.stringify(behavior)});`,
    '',
  ].join('\n');

  writeFileSync(scriptPath, source);

  return scriptPath;
}

export interface FakeProviderRunRecord {
  argv: string[];
  stdin: string;
  cwd: string;
  envKeys: string[];
  env: Record<string, string>;
}

export interface FakeProviderKit {
  directory: string;
  scriptPath: string;
  logFile: string;
  counterFile: string;
  pidFile: string;
  executable: { executablePath: string; prefixArgs: string[] };
  /** Locator compatible with the engine's `CliLocator` port. */
  locator: {
    locate: (command: FakeProviderName) => FakeProviderKit['executable'] | undefined;
  };
  /** Every review run the fake CLI received, oldest first. */
  readRuns: () => FakeProviderRunRecord[];
}

export function createFakeProviderKit(
  provider: FakeProviderName,
  behavior: FakeProviderBehavior = {},
): FakeProviderKit {
  const directory = mkdtempSync(join(tmpdir(), `fake-${provider}-`));
  const logFile = join(directory, 'runs.jsonl');
  const counterFile = join(directory, 'counter.txt');
  const pidFile = join(directory, 'child.pid');
  const scriptPath = writeFakeProviderScript(directory, provider, {
    logFile,
    counterFile,
    pidFile,
    ...behavior,
  });
  const executable = { executablePath: process.execPath, prefixArgs: [scriptPath] };

  return {
    directory,
    scriptPath,
    logFile,
    counterFile,
    pidFile,
    executable,
    locator: { locate: () => executable },
    readRuns: () =>
      existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as FakeProviderRunRecord)
        : [],
  };
}
