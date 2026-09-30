import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProviderId } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import {
  createFakeProviderKit,
  isProcessAlive,
  waitFor,
  type FakeProviderBehavior,
  type FakeProviderKit,
} from '../../../../../tests/fixtures/fake-clis/scenarios.js';
import { ProcessSupervisor } from '../process/process-supervisor.service.js';
import type { ProviderAdapter, ProviderRunRequest } from '../provider-adapter.js';
import { ClaudeAdapter } from './claude.adapter.js';
import { CodexAdapter } from './codex.adapter.js';
import { GeminiAdapter } from './gemini.adapter.js';

const PROMPT = 'PROMPT-SENTINEL review this pull request diff carefully';
const PARENT_ENVIRONMENT = {
  PATH: process.env['PATH'],
  AZURE_DEVOPS_EXT_PAT: 'azure-secret-value',
  SESSION_SECRET: 'session-secret-value',
  ANTHROPIC_API_KEY: 'anthropic-secret-value',
  OPENAI_API_KEY: 'openai-secret-value',
  GEMINI_API_KEY: 'gemini-secret-value',
};
const OWN_SECRET: Record<ProviderId, string> = {
  claude: 'anthropic-secret-value',
  codex: 'openai-secret-value',
  gemini: 'gemini-secret-value',
};

interface Harness {
  provider: ProviderId;
  kit: FakeProviderKit;
  adapter: ProviderAdapter;
  request: (overrides?: Partial<ProviderRunRequest>) => ProviderRunRequest;
}

function createHarness(
  provider: ProviderId,
  behavior: FakeProviderBehavior = {},
): Harness {
  const kit = createFakeProviderKit(provider, {
    version: provider === 'claude' ? '2.1.283' : '1.2.3',
    ...behavior,
  });
  const supervisor = new ProcessSupervisor({ terminationGraceMs: 100 });
  const dependencies = {
    supervisor,
    locator: kit.locator,
    environment: () => PARENT_ENVIRONMENT,
  };
  const adapter: ProviderAdapter =
    provider === 'claude'
      ? new ClaudeAdapter(dependencies)
      : provider === 'codex'
        ? new CodexAdapter(dependencies)
        : new GeminiAdapter({ ...dependencies, sandboxAvailable: () => false });

  const workspacePath = mkdtempSync(join(tmpdir(), 'workspace-'));
  const outputSchemaPath = join(workspacePath, '..', `schema-${provider}.json`);
  writeFileSync(outputSchemaPath, '{"type":"object","additionalProperties":false}');

  return {
    provider,
    kit,
    adapter,
    request: (overrides = {}) => ({
      runId: `run-${provider}-${Math.random().toString(36).slice(2, 8)}`,
      model: 'sonnet',
      workspacePath,
      prompt: PROMPT,
      outputSchemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
      ...overrides,
    }),
  };
}

describe.each(['claude', 'codex', 'gemini'] as const)('%s adapter contract', (provider) => {
  it('detects the installation with an absolute executable path and version', async () => {
    const { adapter } = createHarness(provider);

    const installation = await adapter.detectInstallation();

    expect(installation.installed).toBe(true);
    expect(installation.unsupportedReason).toBeUndefined();
    expect(installation.version).toBe(provider === 'claude' ? '2.1.283' : '1.2.3');
    expect(installation.executable?.executablePath).toBe(process.execPath);
  });

  it('reports a missing CLI without throwing', async () => {
    const adapter = (() => {
      const dependencies = {
        supervisor: new ProcessSupervisor(),
        locator: { locate: () => undefined },
        environment: () => PARENT_ENVIRONMENT,
      };
      return provider === 'claude'
        ? new ClaudeAdapter(dependencies)
        : provider === 'codex'
          ? new CodexAdapter(dependencies)
          : new GeminiAdapter({ ...dependencies, sandboxAvailable: () => false });
    })();

    const installation = await adapter.detectInstallation();
    const authentication = await adapter.checkAuthentication();

    expect(installation.installed).toBe(false);
    expect(authentication.state).toBe('error');
    await expect(adapter.runReview(createHarness(provider).request())).resolves.toMatchObject({
      status: 'failed',
      failure: { kind: 'not_installed' },
    });
  });

  it('sends the prompt on stdin, never on the command line', async () => {
    const harness = createHarness(provider);
    const result = await harness.adapter.runReview(harness.request());

    expect(result.status).toBe('completed');
    const [run] = harness.kit.readRuns();
    expect(run?.stdin).toBe(PROMPT);
    expect(JSON.stringify(run?.argv)).not.toContain('PROMPT-SENTINEL');
  });

  it('runs inside the workspace and returns the raw provider output', async () => {
    const harness = createHarness(provider);
    const request = harness.request();

    const result = await harness.adapter.runReview(request);

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('unreachable');
    expect(result.provider).toBe(provider);
    expect(result.rawOutput).toContain('Unchecked null dereference in loader');
    const [run] = harness.kit.readRuns();
    expect(run?.cwd).toBe(request.workspacePath);
  });

  it('forwards only its own credentials and never Azure or session secrets', async () => {
    const harness = createHarness(provider);
    await harness.adapter.runReview(harness.request());

    const [run] = harness.kit.readRuns();
    const serialized = JSON.stringify(run?.env);
    expect(serialized).toContain(OWN_SECRET[provider]);
    expect(serialized).not.toContain('azure-secret-value');
    expect(serialized).not.toContain('session-secret-value');
    for (const other of (Object.keys(OWN_SECRET) as ProviderId[]).filter(
      (id) => id !== provider,
    )) {
      expect(serialized).not.toContain(OWN_SECRET[other]);
    }
  });

  it('classifies authentication failures with an actionable, secret-free message', async () => {
    const harness = createHarness(provider, { run: 'auth-failure' });

    const result = await harness.adapter.runReview(harness.request());

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.failure.kind).toBe('authentication');
    expect(result.failure.message).toMatch(/log ?in|sign in|authenticat/i);
  });

  it('classifies unknown models', async () => {
    const harness = createHarness(provider, { run: 'model-not-found', badModel: 'nope' });

    const result = await harness.adapter.runReview(harness.request({ model: 'nope' }));

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.failure.kind).toBe('model_unavailable');
  });

  it('redacts credentials that appear in provider error output', async () => {
    const harness = createHarness(provider, {
      run: 'leak-secret',
      secret: OWN_SECRET[provider],
    });

    const result = await harness.adapter.runReview(harness.request());

    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain(OWN_SECRET[provider]);
  });

  it('rejects unsafe model identifiers before spawning anything', async () => {
    const harness = createHarness(provider);

    const result = await harness.adapter.runReview(
      harness.request({ model: '--dangerously-skip-permissions' }),
    );

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'invalid_request' } });
    expect(harness.kit.readRuns()).toHaveLength(0);
  });

  it('refuses to run when the CLI does not meet the safety requirements', async () => {
    const unsupported: FakeProviderBehavior =
      provider === 'claude'
        ? { version: '2.1.100' }
        : { help: { codex: 'Usage: codex\n', 'codex-exec': 'Usage: codex exec\n', gemini: 'Usage: gemini\n' } };
    const harness = createHarness(provider, unsupported);

    const installation = await harness.adapter.detectInstallation();
    const result = await harness.adapter.runReview(harness.request());

    expect(installation.installed).toBe(true);
    expect(installation.unsupportedReason).toBeTruthy();
    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'unsupported' } });
    expect(harness.kit.readRuns()).toHaveLength(0);
  });

  it('reports timeouts', async () => {
    const harness = createHarness(provider, { run: 'hang' });

    const result = await harness.adapter.runReview(harness.request({ timeoutMs: 400 }));

    expect(result.status).toBe('timed_out');
  });

  it('cancels a running review through adapter.cancel and the abort signal', async () => {
    const byCancel = createHarness(provider, { run: 'hang' });
    const cancelRequest = byCancel.request();
    const running = byCancel.adapter.runReview(cancelRequest);
    await waitFor(() => byCancel.kit.readRuns().length === 1);

    await byCancel.adapter.cancel(cancelRequest.runId);
    expect((await running).status).toBe('cancelled');

    const bySignal = createHarness(provider, { run: 'hang' });
    const controller = new AbortController();
    const signalled = bySignal.adapter.runReview(
      bySignal.request({ signal: controller.signal }),
    );
    await waitFor(() => bySignal.kit.readRuns().length === 1);
    controller.abort();
    expect((await signalled).status).toBe('cancelled');
  });

  it('terminates descendant processes on cancellation', async () => {
    const harness = createHarness(provider, { run: 'spawn-child' });
    const request = harness.request();
    const running = harness.adapter.runReview(request);
    await waitFor(() => harness.kit.readRuns().length === 1);
    await waitFor(() => {
      try {
        return Number(readFileSync(harness.kit.pidFile, 'utf8').trim()) > 0;
      } catch {
        return false;
      }
    });
    const childPid = Number(readFileSync(harness.kit.pidFile, 'utf8').trim());

    await harness.adapter.cancel(request.runId);
    await running;

    await waitFor(() => !isProcessAlive(childPid), 5_000);
    expect(isProcessAlive(childPid)).toBe(false);
  });
});
