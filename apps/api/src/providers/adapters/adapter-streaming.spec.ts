import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ActivityVisibility, ProviderId } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import {
  STREAMING_HELP,
  createFakeProviderKit,
  type FakeProviderBehavior,
} from '../../../../../tests/fixtures/fake-clis/scenarios.js';
import { ProviderOutputParser } from '../../reviews/output/provider-output.parser.js';
import { ProcessSupervisor } from '../process/process-supervisor.service.js';
import type {
  ProviderActivityObservation,
  ProviderActivitySink,
  ProviderAdapter,
  ProviderRunRequest,
} from '../provider-adapter.js';
import { ClaudeAdapter } from './claude.adapter.js';
import { CodexAdapter } from './codex.adapter.js';
import { GeminiAdapter } from './gemini.adapter.js';

const LEAK_MARKERS = /PRIVATE-REASONING|FILE-CONTENT|SEARCH-PATTERN|COMMAND-MUST|OUTPUT-MUST|PROMPT-SENTINEL/u;

interface Recording {
  sink: ProviderActivitySink;
  visibilities: ActivityVisibility[];
  activities: ProviderActivityObservation[];
  skipped: number[];
}

function recording(): Recording {
  const record: Recording = { visibilities: [], activities: [], skipped: [], sink: undefined as never };
  record.sink = {
    visibility: (value) => record.visibilities.push(value),
    activity: (value) => record.activities.push(value),
    skipped: (count) => record.skipped.push(count),
  };

  return record;
}

function harness(provider: ProviderId, behavior: FakeProviderBehavior = {}) {
  const kit = createFakeProviderKit(provider, {
    version: provider === 'claude' ? '2.1.283' : '1.2.3',
    ...behavior,
  });
  const dependencies = {
    supervisor: new ProcessSupervisor({ terminationGraceMs: 100 }),
    locator: kit.locator,
    environment: () => ({ PATH: process.env['PATH'] }),
  };
  const adapter: ProviderAdapter =
    provider === 'claude'
      ? new ClaudeAdapter(dependencies)
      : provider === 'codex'
        ? new CodexAdapter(dependencies)
        : new GeminiAdapter({ ...dependencies, sandboxAvailable: () => false });
  const workspacePath = mkdtempSync(join(tmpdir(), 'stream-workspace-'));
  const outputSchemaPath = join(workspacePath, '..', `schema-stream-${provider}.json`);
  writeFileSync(outputSchemaPath, '{"type":"object"}');
  const request = (overrides: Partial<ProviderRunRequest> = {}): ProviderRunRequest => ({
    runId: `stream-${provider}-${Math.random().toString(36).slice(2, 8)}`,
    model: 'cli-default',
    workspacePath,
    prompt: 'PROMPT-SENTINEL review this pull request',
    outputSchemaPath,
    timeoutMs: 15_000,
    signal: new AbortController().signal,
    ...overrides,
  });

  return { kit, adapter, request };
}

const EXPECTED: Record<ProviderId, { visibility: ActivityVisibility; flag: string; activities: ProviderActivityObservation[] }> = {
  claude: {
    visibility: 'full',
    flag: 'stream-json',
    activities: [
      { action: 'thinking' },
      { action: 'reading_file', tool: 'Read', target: { path: 'src/app.ts', startLine: 10, endLine: 29 } },
      // The Grep scope is the checkout root itself, which is not a file path: no target.
      { action: 'searching', tool: 'Grep' },
      { action: 'writing_answer' },
    ],
  },
  codex: {
    visibility: 'partial',
    flag: '--json',
    activities: [
      { action: 'thinking' },
      { action: 'running_command', tool: 'shell' },
      { action: 'writing_answer' },
    ],
  },
  gemini: {
    visibility: 'full',
    flag: 'stream-json',
    activities: [
      { action: 'reading_file', tool: 'read_file', target: { path: 'src/app.ts', startLine: 10, endLine: 29 } },
      { action: 'writing_answer' },
    ],
  },
};

describe.each(['claude', 'codex', 'gemini'] as const)('%s streaming review', (provider) => {
  it('reports sanitized activity and still yields a parseable final answer', async () => {
    const { kit, adapter, request } = harness(provider, { help: STREAMING_HELP });
    const record = recording();

    const result = await adapter.runReview(request({ activity: record.sink }));

    expect(result.status).toBe('completed');
    expect(kit.readRuns()[0]?.argv).toContain(EXPECTED[provider].flag);
    expect(record.visibilities).toEqual([EXPECTED[provider].visibility]);
    expect(record.activities).toEqual(EXPECTED[provider].activities);
    expect(record.skipped).toEqual([]);
    expect(JSON.stringify(record)).not.toMatch(LEAK_MARKERS);
    if (result.status !== 'completed') return;
    expect(result.rawOutput).not.toMatch(/FILE-CONTENT|OUTPUT-MUST/u);
    const parsed = new ProviderOutputParser().parseReviewer({ provider, rawOutput: result.rawOutput });
    // The answer JSON was found and handed to schema validation (the shared fake
    // payload predates later schema fields, so only extraction is asserted here).
    expect(parsed.ok || parsed.error.reason === 'schema_violation').toBe(true);
  });

  it('survives malformed and oversized lines and drops paths outside the checkout', async () => {
    const outside =
      provider === 'gemini'
        ? JSON.stringify({ type: 'tool_use', tool_name: 'read_file', parameters: { file_path: '../../etc/passwd' } })
        : JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '../../etc/passwd' } }] },
          });
    const { adapter, request } = harness(provider, {
      help: STREAMING_HELP,
      streamPrelude: ['not json at all', '[1,2,3]', `{"type":"x","pad":"${'z'.repeat(120_000)}"}`, outside],
    });
    const record = recording();

    const result = await adapter.runReview(request({ activity: record.sink, maxStdoutBytes: 16_384 }));

    expect(result.status).toBe('completed');
    expect(record.skipped).toEqual([3]);
    expect(JSON.stringify(record.activities)).not.toContain('passwd');
  });

  it('keeps running when the activity sink throws', async () => {
    const { adapter, request } = harness(provider, { help: STREAMING_HELP });
    const sink: ProviderActivitySink = {
      visibility: () => {
        throw new Error('sink down');
      },
      activity: () => {
        throw new Error('sink down');
      },
      skipped: () => {
        throw new Error('sink down');
      },
    };

    await expect(adapter.runReview(request({ activity: sink }))).resolves.toMatchObject({ status: 'completed' });
  });

  it('reports an answer larger than the stdout limit as truncated', async () => {
    const { adapter, request } = harness(provider, { help: STREAMING_HELP });

    const result = await adapter.runReview(request({ maxStdoutBytes: 64 }));

    expect(result).toMatchObject({ status: 'failed', failure: { kind: 'output_truncated' } });
  });
});

describe.each(['codex', 'gemini'] as const)('%s without a streaming CLI', (provider) => {
  it('falls back to the final-envelope format with heartbeat-only visibility', async () => {
    const { kit, adapter, request } = harness(provider);
    const record = recording();

    const result = await adapter.runReview(request({ activity: record.sink }));

    expect(result.status).toBe('completed');
    expect(kit.readRuns()[0]?.argv).not.toContain(EXPECTED[provider].flag);
    expect(record.visibilities).toEqual(['heartbeat_only']);
    expect(record.activities).toEqual([]);
  });
});
