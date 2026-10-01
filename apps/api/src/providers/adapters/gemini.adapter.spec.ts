import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createFakeProviderKit,
  type FakeProviderBehavior,
} from '../../../../../tests/fixtures/fake-clis/scenarios.js';
import { ProcessSupervisor } from '../process/process-supervisor.service.js';
import { buildGeminiReviewArgs } from './adapter-command-policy.js';
import { GeminiAdapter } from './gemini.adapter.js';

function create(
  behavior: FakeProviderBehavior = {},
  options: {
    sandboxAvailable?: () => boolean;
    environment?: Record<string, string | undefined>;
    existingFiles?: readonly string[];
    configuredModels?: readonly string[];
  } = {},
) {
  const kit = createFakeProviderKit('gemini', { version: '0.30.1', ...behavior });
  const existing = new Set(options.existingFiles ?? []);
  const adapter = new GeminiAdapter({
    supervisor: new ProcessSupervisor({ terminationGraceMs: 100 }),
    locator: kit.locator,
    environment: () => options.environment ?? { PATH: process.env['PATH'] },
    sandboxAvailable: options.sandboxAvailable ?? (() => false),
    homeDirectory: '/home/tester',
    fileSystem: { isFile: (path) => existing.has(path.replaceAll('\\', '/')) },
    ...(options.configuredModels ? { configuredModels: options.configuredModels } : {}),
  });

  return { kit, adapter };
}

async function runOnce(adapter: GeminiAdapter, model = 'pro') {
  const directory = mkdtempSync(join(tmpdir(), 'gemini-run-'));
  const schemaPath = join(directory, 'schema.json');
  writeFileSync(schemaPath, '{"type":"object"}');

  return adapter.runReview({
    runId: `gemini-${Math.random().toString(36).slice(2, 8)}`,
    model,
    workspacePath: directory,
    prompt: 'review it',
    outputSchemaPath: schemaPath,
    timeoutMs: 15_000,
    signal: new AbortController().signal,
  });
}

describe('GeminiAdapter', () => {
  it('requires plan approval mode support', async () => {
    const installation = await create({
      help: { gemini: 'Usage: gemini\n --approval-mode choices: default, yolo\n' },
    }).adapter.detectInstallation();

    expect(installation.unsupportedReason).toMatch(/plan/i);
    expect((await create().adapter.detectInstallation()).unsupportedReason).toBeUndefined();
  });

  it('runs in plan mode without sandbox when no sandbox runtime exists', async () => {
    const { kit, adapter } = create();

    const result = await runOnce(adapter, 'flash');

    expect(result.status).toBe('completed');
    expect(kit.readRuns()[0]?.argv).toEqual(
      buildGeminiReviewArgs({ model: 'flash', sandbox: false }),
    );
    expect(kit.readRuns()[0]?.stdin).toBe('review it');
  });

  it('enables the sandbox when a sandbox runtime is available', async () => {
    const { kit, adapter } = create({}, { sandboxAvailable: () => true });

    await runOnce(adapter);

    expect(kit.readRuns()[0]?.argv).toEqual(
      buildGeminiReviewArgs({ model: 'pro', sandbox: true }),
    );
  });

  it('reports unknown_until_run when credentials exist and unauthenticated when none do', async () => {
    const withKey = await create(
      {},
      { environment: { PATH: process.env['PATH'], GEMINI_API_KEY: 'k' } },
    ).adapter.checkAuthentication();
    expect(withKey.state).toBe('unknown_until_run');

    const withOauth = await create(
      {},
      { existingFiles: ['/home/tester/.gemini/oauth_creds.json'] },
    ).adapter.checkAuthentication();
    expect(withOauth.state).toBe('unknown_until_run');

    const none = await create().adapter.checkAuthentication();
    expect(none.state).toBe('unauthenticated');
    expect(none).toMatchObject({ message: expect.stringContaining('gemini') });
  });

  it('never invokes the model while checking authentication', async () => {
    const { kit, adapter } = create(
      {},
      { environment: { PATH: process.env['PATH'], GEMINI_API_KEY: 'k' } },
    );

    await adapter.checkAuthentication();

    expect(kit.readRuns()).toHaveLength(0);
  });

  it('lists the documented Gemini aliases plus the CLI default', async () => {
    const catalog = await create().adapter.listModels();

    expect(catalog.discovery).toBe('maintained');
    expect(catalog.models.map((model) => model.id)).toEqual([
      'cli-default',
      'pro',
      'flash',
      'flash-lite',
    ]);
  });

  it('treats an error object in the JSON envelope as a classified failure even with exit code 0', async () => {
    const { adapter } = create({ run: 'error-envelope' });

    const result = await runOnce(adapter, 'gemini-x');

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'model_unavailable' } });
  });

  it('reports an ineligible Google account as an authentication failure with its exit code', async () => {
    const { adapter } = create({ run: 'ineligible-account' });

    const result = await runOnce(adapter, 'flash');

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'authentication', exitCode: 41 } });
    if (result.status !== 'failed') throw new Error('expected failure');
    expect(result.failure.message).toContain('GEMINI_API_KEY');
    expect(result.failure.message).toContain('exited with code 41');
    expect(result.failure.diagnostics).toContain('IneligibleTierError');
  });

  it('advertises no explicit reasoning effort for any model', async () => {
    const catalog = await create({}, { configuredModels: ['gemini-custom'] }).adapter.listModels();

    expect(catalog.models.every((model) => model.supportedReasoningEfforts === undefined)).toBe(true);
  });

  it('fails an explicit effort before spawning instead of silently dropping it', async () => {
    const { kit, adapter } = create();
    const directory = mkdtempSync(join(tmpdir(), 'gemini-effort-'));
    const schemaPath = join(directory, 'schema.json');
    writeFileSync(schemaPath, '{"type":"object"}');

    const result = await adapter.runReview({
      runId: 'gemini-effort',
      model: 'pro',
      reasoningEffort: 'high',
      workspacePath: directory,
      prompt: 'review it',
      outputSchemaPath: schemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'invalid_request' } });
    expect(kit.readRuns()).toHaveLength(0);
  });
});
