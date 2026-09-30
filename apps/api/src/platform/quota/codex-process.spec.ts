import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCodexQuotaProcess } from './codex-process.js';
const fixture = fileURLToPath(
  new URL('./fixtures/app-server.mjs', import.meta.url),
);
const read = (scenario: string, signal = new AbortController().signal) =>
  readCodexQuotaProcess(
    { executablePath: process.execPath, prefixArgs: [fixture, scenario] },
    signal,
    { timeoutMs: 1000 },
  );
describe('bounded Codex quota process', () => {
  it('filters Azure/other-provider secrets and runtime injection variables', async () => {
    const value = await readCodexQuotaProcess(
      { executablePath: process.execPath, prefixArgs: [fixture, 'env'] },
      new AbortController().signal,
      {
        environment: {
          ...process.env,
          AZURE_DEVOPS_PAT: 'synthetic-pat',
          GEMINI_API_KEY: 'synthetic-gemini-key',
          OPENAI_API_KEY: 'synthetic-openai-key',
          NODE_OPTIONS: '--invalid-option',
        },
      },
    );
    expect(value.status).toBe('available');
  });
  it('terminates a running quota process and descendant on cancellation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'quota-tree-'));
    const path = join(directory, 'pid.txt');
    const abort = new AbortController();
    let pid: number | undefined;
    const result = readCodexQuotaProcess(
      { executablePath: process.execPath, prefixArgs: [fixture, 'tree', path] },
      abort.signal,
      { timeoutMs: 10000 },
    );
    try {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        try {
          pid = Number(await readFile(path, 'utf8'));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      expect(pid).toBeGreaterThan(0);
      abort.abort();
      expect((await result).status).toBe('error');
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      abort.abort();
      await result;
      if (pid)
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already terminated */
        }
      await unlink(path).catch(() => undefined);
      await rmdir(directory);
    }
  }, 15000);
  it('uses initialized read-only RPCs and returns only quota values', async () => {
    const value = await read('ok');
    expect(value.status).toBe('available');
    expect(value.windows.map((w) => w.remainingPercent)).toEqual([75, 50]);
    expect(JSON.stringify(value)).not.toMatch(/private|email|accountId/);
  });
  it.each([
    ['noauth', 'unauthenticated'],
    ['apikey', 'unavailable'],
    ['unsupported', 'unavailable'],
    ['error', 'error'],
    ['malformed', 'error'],
    ['exit', 'error'],
    ['flood', 'error'],
    ['stderr', 'error'],
    ['hang', 'error'],
  ])('handles %s without leaking diagnostics', async (scenario, status) => {
    const value = await read(scenario);
    expect(value.status).toBe(status);
    expect(value.windows).toEqual([]);
    expect(JSON.stringify(value)).not.toContain('private-secret');
  });
  it('honors cancellation and rejects unsafe executables before launching', async () => {
    const abort = new AbortController();
    abort.abort();
    expect((await read('hang', abort.signal)).status).toBe('error');
    await expect(
      readCodexQuotaProcess(
        { executablePath: 'cmd.exe', prefixArgs: [] },
        abort.signal,
      ),
    ).rejects.toThrow('executable');
  });
});
