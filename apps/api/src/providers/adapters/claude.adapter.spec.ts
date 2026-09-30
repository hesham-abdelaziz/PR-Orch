import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createFakeProviderKit,
  type FakeProviderBehavior,
} from '../../../../../tests/fixtures/fake-clis/scenarios.js';
import { ProcessSupervisor } from '../process/process-supervisor.service.js';
import { buildClaudeReviewArgs } from './adapter-command-policy.js';
import { ClaudeAdapter } from './claude.adapter.js';

function create(
  behavior: FakeProviderBehavior = {},
  options: { configuredModels?: readonly string[] } = {},
) {
  const kit = createFakeProviderKit('claude', { version: '2.1.283', ...behavior });
  const adapter = new ClaudeAdapter({
    supervisor: new ProcessSupervisor({ terminationGraceMs: 100 }),
    locator: kit.locator,
    environment: () => ({ PATH: process.env['PATH'] }),
    ...options,
  });

  return { kit, adapter };
}

describe('ClaudeAdapter', () => {
  it('requires Claude Code 2.1.259 or newer for permission-prompt and restricted-mode flags', async () => {
    for (const [version, supported] of [
      ['2.1.258', false],
      ['2.1.259', true],
      ['2.2.0', true],
      ['10.0.0', true],
      ['1.9.9', false],
    ] as const) {
      const installation = await create({ version }).adapter.detectInstallation();

      expect(installation.installed).toBe(true);
      expect(installation.unsupportedReason === undefined).toBe(supported);
    }
  });

  it('maps `claude auth status` exit codes to authentication states', async () => {
    expect(await create({ authenticated: true }).adapter.checkAuthentication()).toEqual({
      state: 'authenticated',
    });

    const unauthenticated = await create({ authenticated: false }).adapter.checkAuthentication();
    expect(unauthenticated.state).toBe('unauthenticated');
    expect(unauthenticated).toMatchObject({
      message: expect.stringContaining('claude auth login'),
    });
  });

  it('runs exactly the restricted plan-mode profile with the schema inline', async () => {
    const { kit, adapter } = create();
    const directory = mkdtempSync(join(tmpdir(), 'claude-run-'));
    const schemaPath = join(directory, 'schema.json');
    writeFileSync(schemaPath, '{\n  "type": "object",\n  "additionalProperties": false\n}\n');

    const result = await adapter.runReview({
      runId: 'claude-exact',
      model: 'opus',
      workspacePath: directory,
      prompt: 'review it',
      outputSchemaPath: schemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('unreachable');
    expect(JSON.parse(result.rawOutput)).toMatchObject({
      type: 'result',
      is_error: false,
      structured_output: { findings: [{ severity: 'high' }] },
    });
    expect(kit.readRuns()[0]?.argv).toEqual(
      buildClaudeReviewArgs({
        model: 'opus',
        schemaJson: '{"type":"object","additionalProperties":false}',
      }),
    );
  });

  it('fails clearly when the schema file is unreadable or not JSON', async () => {
    const { adapter, kit } = create();
    const directory = mkdtempSync(join(tmpdir(), 'claude-run-'));
    const schemaPath = join(directory, 'schema.json');
    writeFileSync(schemaPath, 'not json');

    const result = await adapter.runReview({
      runId: 'claude-bad-schema',
      model: 'opus',
      workspacePath: directory,
      prompt: 'review it',
      outputSchemaPath: schemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'invalid_request' } });
    expect(kit.readRuns()).toHaveLength(0);
  });

  it('lists maintained aliases and marks locally configured models', async () => {
    const maintained = await create().adapter.listModels();
    expect(maintained.discovery).toBe('maintained');
    expect(maintained.models.map((model) => model.id)).toEqual([
      'cli-default',
      'sonnet',
      'opus',
      'haiku',
      'fable',
    ]);
    expect(maintained.models.every((model) => model.available)).toBe(true);

    const configured = await create(
      {},
      { configuredModels: ['claude-custom-1', 'bad model', 'sonnet'] },
    ).adapter.listModels();
    expect(configured.discovery).toBe('configured');
    expect(configured.models.map((model) => model.id)).toEqual([
      'cli-default',
      'sonnet',
      'opus',
      'haiku',
      'fable',
      'claude-custom-1',
    ]);
  });

  it('treats an is_error result envelope as a classified failure even with exit code 0', async () => {
    const { adapter } = create({ run: 'error-envelope' });
    const directory = mkdtempSync(join(tmpdir(), 'claude-run-'));
    const schemaPath = join(directory, 'schema.json');
    writeFileSync(schemaPath, '{"type":"object"}');

    const result = await adapter.runReview({
      runId: 'claude-error-envelope',
      model: 'opus',
      workspacePath: directory,
      prompt: 'review it',
      outputSchemaPath: schemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'authentication' } });
  });
});
