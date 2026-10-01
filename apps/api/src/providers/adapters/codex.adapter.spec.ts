import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createFakeProviderKit,
  type FakeProviderBehavior,
} from '../../../../../tests/fixtures/fake-clis/scenarios.js';
import { ProcessSupervisor } from '../process/process-supervisor.service.js';
import { buildCodexReviewArgs } from './adapter-command-policy.js';
import type { CatalogModel } from '../model-catalog.service.js';
import { CodexAdapter } from './codex.adapter.js';

function create(
  behavior: FakeProviderBehavior = {},
  options: {
    configuredModels?: readonly string[];
    accountModels?: () => readonly CatalogModel[] | undefined;
  } = {},
) {
  const kit = createFakeProviderKit('codex', { version: '0.99.0', ...behavior });
  const adapter = new CodexAdapter({
    supervisor: new ProcessSupervisor({ terminationGraceMs: 100 }),
    locator: kit.locator,
    environment: () => ({ PATH: process.env['PATH'] }),
    ...options,
  });

  return { kit, adapter };
}

describe('CodexAdapter', () => {
  it('parses `codex --version` output', async () => {
    const installation = await create({ version: '0.42.7' }).adapter.detectInstallation();

    expect(installation.version).toBe('0.42.7');
  });

  it('requires the read-only sandbox, approval, ephemeral, and schema capabilities', async () => {
    for (const [name, help] of [
      ['no --ephemeral', { 'codex-exec': 'Usage\n --sandbox\n --output-schema\n --cd\n' }],
      ['no --output-schema', { 'codex-exec': 'Usage\n --sandbox\n --ephemeral\n --cd\n' }],
      ['no --sandbox', { 'codex-exec': 'Usage\n --ephemeral\n --output-schema\n --cd\n' }],
      ['no --ask-for-approval', { codex: 'Usage: codex\n --sandbox\n' }],
    ] as const) {
      const installation = await create({ help }).adapter.detectInstallation();

      expect(installation.unsupportedReason, name).toBeTruthy();
    }

    expect((await create().adapter.detectInstallation()).unsupportedReason).toBeUndefined();
  });

  it('maps `codex login status` to authentication states', async () => {
    expect(await create({ authenticated: true }).adapter.checkAuthentication()).toEqual({
      state: 'authenticated',
    });
    const result = await create({ authenticated: false }).adapter.checkAuthentication();
    expect(result.state).toBe('unauthenticated');
    expect(result).toMatchObject({ message: expect.stringContaining('codex login') });
  });

  it('runs exactly the read-only, no-approval profile with a stdin prompt', async () => {
    const { kit, adapter } = create();
    const directory = mkdtempSync(join(tmpdir(), 'codex-run-'));
    const schemaPath = join(directory, 'schema.json');
    writeFileSync(schemaPath, '{"type":"object"}');

    const result = await adapter.runReview({
      runId: 'codex-exact',
      model: 'my-model',
      workspacePath: directory,
      prompt: 'review it',
      outputSchemaPath: schemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('completed');
    const [run] = kit.readRuns();
    expect(run?.argv).toEqual(
      buildCodexReviewArgs({
        model: 'my-model',
        schemaPath,
        workspacePath: directory,
      }),
    );
    expect(run?.stdin).toBe('review it');
  });

  it('offers the CLI default plus locally configured models only', async () => {
    const catalog = await create({}, { configuredModels: ['gpt-local'] }).adapter.listModels();

    expect(catalog.discovery).toBe('configured');
    expect(catalog.models.map((model) => model.id)).toEqual(['cli-default', 'gpt-local']);

    const bare = await create().adapter.listModels();
    expect(bare.discovery).toBe('maintained');
    expect(bare.models.map((model) => model.id)).toEqual(['cli-default']);
  });

  it('delivers the requested reasoning effort to the codex process as a -c override', async () => {
    const { kit, adapter } = create();
    const directory = mkdtempSync(join(tmpdir(), 'codex-effort-'));
    const schemaPath = join(directory, 'schema.json');
    writeFileSync(schemaPath, '{"type":"object"}');

    const result = await adapter.runReview({
      runId: 'codex-effort',
      model: 'gpt-local',
      reasoningEffort: 'medium',
      workspacePath: directory,
      prompt: 'review it',
      outputSchemaPath: schemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('completed');
    const [run] = kit.readRuns();
    expect(run?.argv.slice(-3)).toEqual(['-c', 'model_reasoning_effort="medium"', '-']);
    expect(run?.argv).toContain('read-only');
  });

  it('advertises low/medium/high for configured models and Default only for the CLI default', async () => {
    const catalog = await create({}, { configuredModels: ['gpt-local'] }).adapter.listModels();

    expect(catalog.models.find((model) => model.id === 'cli-default')?.supportedReasoningEfforts).toBeUndefined();
    expect(catalog.models.find((model) => model.id === 'gpt-local')?.supportedReasoningEfforts).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('lists the models Codex cached for the account, keeping configured models and their cached efforts', async () => {
    const catalog = await create(
      {},
      {
        configuredModels: ['gpt-6.1-sol', 'gpt-local'],
        accountModels: () => [
          { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol (gpt-6.1-sol)', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
          { id: 'gpt-6-sol', label: 'GPT-6-Sol (gpt-6-sol)', supportedReasoningEfforts: ['low', 'medium'] },
        ],
      },
    ).adapter.listModels();

    expect(catalog.discovery).toBe('dynamic');
    expect(catalog.models.map((model) => model.id)).toEqual(['cli-default', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-local']);
    expect(catalog.models.find((model) => model.id === 'gpt-6.1-sol')).toMatchObject({
      label: 'GPT-6.1-Sol (gpt-6.1-sol)',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    });
    expect(catalog.models.find((model) => model.id === 'gpt-local')?.label).toBe('gpt-local (configured locally)');
  });

  it('falls back to the configured catalog when the account model cache is missing or throws', async () => {
    for (const accountModels of [() => undefined, () => [], () => { throw new Error('unreadable'); }]) {
      const catalog = await create({}, { configuredModels: ['gpt-local'], accountModels }).adapter.listModels();

      expect(catalog.discovery).toBe('configured');
      expect(catalog.models.map((model) => model.id)).toEqual(['cli-default', 'gpt-local']);
    }
  });

  it('re-reads the account model cache on every catalog refresh', async () => {
    let models: CatalogModel[] = [{ id: 'gpt-a', label: 'A' }];
    const { adapter } = create({}, { accountModels: () => models });

    expect((await adapter.listModels()).models.map((model) => model.id)).toEqual(['cli-default', 'gpt-a']);
    models = [{ id: 'gpt-b', label: 'B' }];
    expect((await adapter.listModels()).models.map((model) => model.id)).toEqual(['cli-default', 'gpt-b']);
  });

  // Regression (review 9db2497e): Codex prints a non-fatal ERROR and its banner
  // before the fatal cause, and the failure message kept only the first 300
  // characters, so the persisted reason never showed why the run failed.
  it('keeps the fatal tail of stderr and the exit code when codex exec fails', async () => {
    const { adapter } = create({ run: 'banner-then-error', fatalMessage: 'the fatal reason codex gave' });
    const directory = mkdtempSync(join(tmpdir(), 'codex-fail-'));
    const schemaPath = join(directory, 'schema.json');
    writeFileSync(schemaPath, '{"type":"object"}');

    const result = await adapter.runReview({
      runId: 'codex-banner-failure',
      model: 'my-model',
      workspacePath: directory,
      prompt: 'review it',
      outputSchemaPath: schemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('expected failure');
    expect(result.failure.kind).toBe('process');
    expect(result.failure.exitCode).toBe(1);
    expect(result.failure.message).toContain('exited with code 1');
    expect(result.failure.message).toContain('the fatal reason codex gave');
    expect(result.failure.diagnostics).toContain('FATAL: the fatal reason codex gave');
    expect(result.failure.diagnostics).toContain('Fake Codex v0.99.0');
  });
});
