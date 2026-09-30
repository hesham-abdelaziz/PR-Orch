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
import { CodexAdapter } from './codex.adapter.js';

function create(
  behavior: FakeProviderBehavior = {},
  options: { configuredModels?: readonly string[] } = {},
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
});
