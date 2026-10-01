import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NPM_NATIVE_EXE_SHIM } from '../../../../../tests/fixtures/fake-clis/windows-npm-shims.js';
import {
  createFakeProviderKit,
  type FakeProviderBehavior,
} from '../../../../../tests/fixtures/fake-clis/scenarios.js';
import type { ProcessRunRequest, ProcessRunResult } from '../process/process-runner.types.js';
import { ProcessSupervisor } from '../process/process-supervisor.service.js';
import { WindowsCliResolver } from '../windows-cli-resolver.js';
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

describe('ClaudeAdapter with the Windows npm wrapper', () => {
  it('reports Claude Code installed and supported through its native npm launch target', async () => {
    const prefix = 'C:\\Program Files\\nodejs';
    const exe = `${prefix}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    const files = new Map([
      [`${prefix}\\claude.cmd`.toLowerCase(), NPM_NATIVE_EXE_SHIM],
      [exe.toLowerCase(), ''],
    ]);
    const spawned: Pick<ProcessRunRequest, 'executablePath' | 'args'>[] = [];
    const supervisor = {
      run: (request: ProcessRunRequest): Promise<ProcessRunResult> => {
        spawned.push({ executablePath: request.executablePath, args: request.args });

        return Promise.resolve({
          runId: request.runId,
          status: 'completed',
          exitCode: 0,
          stdout: '2.1.280 (Claude Code)\n',
          stderr: '',
          stdoutBytes: 22,
          stderrBytes: 0,
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
        });
      },
      cancel: () => Promise.resolve(),
    } as unknown as ProcessSupervisor;
    const adapter = new ClaudeAdapter({
      supervisor,
      locator: new WindowsCliResolver({
        platform: 'win32',
        environment: { Path: `C:\\Windows\\System32;${prefix}`, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        fileSystem: {
          isFile: (path) => files.has(path.toLowerCase()),
          readText: (path) => files.get(path.toLowerCase()),
        },
        nodeExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
      }),
      environment: () => ({}),
    });

    const installation = await adapter.detectInstallation();

    expect(installation).toEqual({
      installed: true,
      executable: { executablePath: exe, prefixArgs: [] },
      displayPath: exe,
      version: '2.1.280',
    });
    expect(spawned).toEqual([{ executablePath: exe, args: ['--version'] }]);
  });

  it('delivers the requested reasoning effort to the claude process through --effort', async () => {
    const { kit, adapter } = create();
    const directory = mkdtempSync(join(tmpdir(), 'claude-effort-'));
    const schemaPath = join(directory, 'schema.json');
    writeFileSync(schemaPath, '{"type":"object"}');

    const result = await adapter.runReview({
      runId: 'claude-effort',
      model: 'opus',
      reasoningEffort: 'xhigh',
      workspacePath: directory,
      prompt: 'review it',
      outputSchemaPath: schemaPath,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('completed');
    const [run] = kit.readRuns();
    expect(run?.argv.slice(-2)).toEqual(['--effort', 'xhigh']);
    expect(run?.argv).toContain('--restricted');
  });

  it('advertises documented effort levels per alias, and none for haiku or the CLI default', async () => {
    const catalog = await create({}, { configuredModels: ['claude-custom'] }).adapter.listModels();
    const efforts = Object.fromEntries(catalog.models.map((model) => [model.id, model.supportedReasoningEfforts]));
    const full = ['low', 'medium', 'high', 'xhigh', 'max'];

    expect(efforts['opus']).toEqual(full);
    expect(efforts['sonnet']).toEqual(full);
    expect(efforts['fable']).toEqual(full);
    expect(efforts['haiku']).toBeUndefined();
    expect(efforts['cli-default']).toBeUndefined();
    expect(efforts['claude-custom']).toBeUndefined();
  });
});
