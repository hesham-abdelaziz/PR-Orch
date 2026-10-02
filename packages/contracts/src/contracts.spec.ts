import { describe, expect, it } from 'vitest';

import {
  CreateReviewRequestSchema,
  JobStateSchema,
  ModelCatalogEntry,
  ModelSelection,
  ModelSelectionSchema,
  ProviderStatusSchema,
  REASONING_EFFORT_VALUES,
  ReasoningEffortSchema,
  ReviewEventSchema,
  ReviewFindingSchema,
  PullRequestSummarySchema,
  assertModelSelectionSupported,
  getSupportedReasoningEfforts,
  isReasoningEffortSupported,
} from './index.js';

const reviewer = { provider: 'codex', model: 'gpt-codex' } as const;

describe('pull request line totals', () => {
  const summary = {
    url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/12',
    organization: 'org', project: 'project', repository: 'repo', pullRequestId: 12,
    title: 'Review', author: { id: 'author', displayName: 'Author' },
    sourceBranch: 'feature', targetBranch: 'main', sourceCommit: 'a'.repeat(40), targetCommit: 'b'.repeat(40),
    changedFiles: 5, additions: 4, deletions: 2, updatedAt: '2026-10-02T00:00:00.000Z',
  };

  it.each([null, 0, 4])('accepts unknown or measured totals %j without breaking stored summaries', count => {
    const input = { ...summary, additions: count, deletions: count };
    expect(PullRequestSummarySchema.parse(input)).toEqual(input);
  });

  it.each([-1, 0.5, undefined, '4'])('rejects invalid totals %j', count => {
    expect(PullRequestSummarySchema.safeParse({ ...summary, additions: count }).success).toBe(false);
    expect(PullRequestSummarySchema.safeParse({ ...summary, deletions: count }).success).toBe(false);
  });
});

describe('shared contracts', () => {
  it('rejects_unknown_provider', () => {
    const result = ProviderStatusSchema.safeParse({
      provider: 'unknown-provider',
      installed: true,
      executablePath: 'C:/tools/unknown.exe',
      version: '1.0.0',
      authentication: { state: 'authenticated' },
      modelCatalog: { discovery: 'maintained', models: [] },
      refreshedAt: '2026-09-29T12:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('rejects_finding_without_evidence', () => {
    const result = ReviewFindingSchema.safeParse({
      id: '2f5b02de-54d7-4e45-9227-684754f40ee8',
      title: 'Missing authorization check',
      severity: 'high',
      filePath: 'src/auth.ts',
      location: { startLine: 42 },
      impact: 'An unauthenticated caller can read protected data.',
      suggestedFix: 'Require an authenticated principal before reading.',
      origins: [reviewer],
    });

    expect(result.success).toBe(false);
  });

  it('rejects_review_without_reviewer', () => {
    const result = CreateReviewRequestSchema.safeParse({
      pullRequestUrl:
        'https://dev.azure.com/example/project/_git/repository/pullrequest/17',
      main: { provider: 'claude', model: 'sonnet' },
      reviewers: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects_duplicate_reviewer_selection', () => {
    const result = CreateReviewRequestSchema.safeParse({
      pullRequestUrl:
        'https://dev.azure.com/example/project/_git/repository/pullrequest/17',
      main: { provider: 'claude', model: 'sonnet' },
      reviewers: [reviewer, reviewer],
    });

    expect(result.success).toBe(false);
  });

  it('accepts_all_job_states', () => {
    const states = [
      'queued',
      'preparing',
      'reviewing',
      'verifying',
      'rendering',
      'completed',
      'failed',
      'cancelling',
      'cancelled',
    ] as const;

    for (const state of states) {
      expect(JobStateSchema.safeParse(state).success).toBe(true);
    }
  });

  it('rejects_event_with_unknown_payload', () => {
    const result = ReviewEventSchema.safeParse({
      reviewId: '9d6f558d-5baa-4733-a156-b6f9cc8a4e4f',
      sequence: 1,
      emittedAt: '2026-09-29T12:00:00.000Z',
      type: 'job.state_changed',
      payload: { state: 'mystery-state' },
    });

    expect(result.success).toBe(false);
  });
});

describe('reasoning effort contracts and compatibility', () => {
  it('parses_valid_effort_values_and_preserves_compatibility_without_effort', () => {
    // Backward compatibility: no reasoningEffort
    const legacy = ModelSelectionSchema.parse({ provider: 'codex', model: 'gpt-5' });
    expect(legacy.reasoningEffort).toBeUndefined();

    // Explicit valid efforts
    for (const effort of REASONING_EFFORT_VALUES) {
      const parsed = ModelSelectionSchema.parse({
        provider: 'claude',
        model: 'sonnet',
        reasoningEffort: effort,
      });
      expect(parsed.reasoningEffort).toBe(effort);
    }

    // Rejects invalid effort strings
    const invalid = ModelSelectionSchema.safeParse({
      provider: 'codex',
      model: 'gpt-5',
      reasoningEffort: 'super-high',
    });
    expect(invalid.success).toBe(false);
  });

  it('rejects_duplicate_reviewers_even_with_different_effort_levels', () => {
    const result = CreateReviewRequestSchema.safeParse({
      pullRequestUrl: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/1',
      main: { provider: 'claude', model: 'opus', reasoningEffort: 'high' },
      reviewers: [
        { provider: 'codex', model: 'gpt-5', reasoningEffort: 'low' },
        { provider: 'codex', model: 'gpt-5', reasoningEffort: 'high' },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Duplicate provider/model reviewer selection');
    }
  });

  it('allows_independent_effort_selections_for_main_and_each_reviewer', () => {
    const request = {
      pullRequestUrl: 'https://dev.azure.com/org/proj/_git/repo/pullrequest/42',
      main: { provider: 'codex', model: 'o3', reasoningEffort: 'high' },
      reviewers: [
        { provider: 'claude', model: 'sonnet', reasoningEffort: 'medium' },
        { provider: 'gemini', model: 'pro', reasoningEffort: 'low' },
        { provider: 'codex', model: 'cli-default', reasoningEffort: 'default' },
      ],
    };
    const parsed = CreateReviewRequestSchema.parse(request);
    expect(parsed.main.reasoningEffort).toBe('high');
    expect(parsed.reviewers[0].reasoningEffort).toBe('medium');
    expect(parsed.reviewers[1].reasoningEffort).toBe('low');
    expect(parsed.reviewers[2].reasoningEffort).toBe('default');
  });

  it('evaluates_model_capability_filtering_accurately', () => {
    const modelWithEfforts: ModelCatalogEntry = {
      id: 'o3',
      label: 'OpenAI o3',
      available: true,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    };

    const modelWithoutEffortCapability: ModelCatalogEntry = {
      id: 'cli-default',
      label: 'CLI default',
      available: true,
    };

    // Models with capability metadata
    expect(getSupportedReasoningEfforts(modelWithEfforts)).toEqual(['default', 'low', 'medium', 'high']);
    expect(isReasoningEffortSupported(modelWithEfforts, 'high')).toBe(true);
    expect(isReasoningEffortSupported(modelWithEfforts, 'low')).toBe(true);
    expect(isReasoningEffortSupported(modelWithEfforts, 'default')).toBe(true);
    expect(isReasoningEffortSupported(modelWithEfforts, undefined)).toBe(true);
    expect(isReasoningEffortSupported(modelWithEfforts, 'xhigh')).toBe(false);

    // Models without capability metadata permit Default / undefined only
    expect(getSupportedReasoningEfforts(modelWithoutEffortCapability)).toEqual(['default']);
    expect(isReasoningEffortSupported(modelWithoutEffortCapability, 'default')).toBe(true);
    expect(isReasoningEffortSupported(modelWithoutEffortCapability, undefined)).toBe(true);
    expect(isReasoningEffortSupported(modelWithoutEffortCapability, 'low')).toBe(false);
    expect(isReasoningEffortSupported(modelWithoutEffortCapability, 'high')).toBe(false);
  });

  it('assertModelSelectionSupported_enforces_capabilities_and_throws_actionable_errors', () => {
    const catalog: ModelCatalogEntry[] = [
      {
        id: 'sonnet',
        label: 'Sonnet',
        available: true,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'max'],
      },
      {
        id: 'legacy-alias',
        label: 'Legacy Alias',
        available: true,
      },
      {
        id: 'disabled-model',
        label: 'Disabled',
        available: false,
        unavailableReason: 'Quota exceeded',
      },
    ];

    // Supported combination
    expect(() =>
      assertModelSelectionSupported(
        { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' },
        catalog,
      ),
    ).not.toThrow();

    // Default/omitted effort always supported
    expect(() =>
      assertModelSelectionSupported(
        { provider: 'claude', model: 'sonnet', reasoningEffort: 'default' },
        catalog,
      ),
    ).not.toThrow();
    expect(() =>
      assertModelSelectionSupported(
        { provider: 'claude', model: 'legacy-alias' },
        catalog,
      ),
    ).not.toThrow();

    // Unsupported effort on model lacking capability
    expect(() =>
      assertModelSelectionSupported(
        { provider: 'claude', model: 'legacy-alias', reasoningEffort: 'high' },
        catalog,
      ),
    ).toThrowError(/Reasoning effort "high" is not supported by model "legacy-alias"/);

    // Unsupported effort on model with limited capability
    expect(() =>
      assertModelSelectionSupported(
        { provider: 'claude', model: 'sonnet', reasoningEffort: 'xhigh' },
        catalog,
      ),
    ).toThrowError(/Reasoning effort "xhigh" is not supported by model "sonnet"/);

    // Unavailable model
    expect(() =>
      assertModelSelectionSupported(
        { provider: 'claude', model: 'disabled-model' },
        catalog,
      ),
    ).toThrowError(/Model "disabled-model" is unavailable/);

    // Unknown model
    expect(() =>
      assertModelSelectionSupported(
        { provider: 'claude', model: 'nonexistent' },
        catalog,
      ),
    ).toThrowError(/Model "nonexistent" is not offered/);
  });
});
import { RunActivitySchema, RunActivitySummarySchema, ReviewJobSchema } from './index.js';

describe('run activity contracts', () => {
  const runId = '2f5b02de-54d7-4e45-9227-684754f40ee8';
  const at = '2026-09-29T12:00:00.000Z';
  const entry = { id: `${runId}:1`, runId, seq: 1, at, kind: 'provider', action: 'reading_file', tool: 'Read', target: { path: 'src/auth.ts', startLine: 1, endLine: 2 } };
  const summary = { visibility: 'full', recent: [entry], current: entry, lastActivityAt: at, lastHeartbeatAt: null, total: 1 };
  const base = { reviewId: runId, sequence: 1, emittedAt: at };

  it('round-trips activity and heartbeat events for both roles', () => {
    for (const role of ['reviewer', 'verifier']) {
      for (const event of [
        { ...base, type: 'run.activity', payload: { runId, role, activity: entry, visibility: 'full', total: 1, lastActivityAt: at } },
        { ...base, type: 'run.heartbeat', payload: { runId, role, at } },
        { ...base, type: 'reviewer.state_changed', payload: { runId, role, reviewer, state: 'running', startedAt: at, completedAt: null } },
      ]) expect(ReviewEventSchema.parse(event)).toEqual(event);
    }
  });

  it('accepts legacy jobs and state events and optional verifier activity', () => {
    const run = { id: runId, selection: reviewer, state: 'queued', startedAt: null, completedAt: null, warning: null };
    const job = {
      id: runId, state: 'queued', main: reviewer, reviewers: [run], standards: null, warnings: [],
      createdAt: at, updatedAt: at, completedAt: null,
      pullRequest: { url: 'https://example.com/pr/1', organization: 'org', project: 'project', repository: 'repo', pullRequestId: 1, title: 'PR', author: { id: 'user', displayName: 'User' }, sourceBranch: 'feature', targetBranch: 'main', sourceCommit: 'abcdef0', targetCommit: 'abcdef1', changedFiles: 1, additions: 1, deletions: 0, updatedAt: at },
    };
    expect(ReviewJobSchema.parse(job)).toEqual(job);
    expect(ReviewJobSchema.parse({ ...job, verifier: { ...run, activity: summary } }).verifier?.activity).toEqual(summary);
    const event = { ...base, type: 'reviewer.state_changed', payload: { runId, reviewer, state: 'queued' } };
    expect(ReviewEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    { kind: 'lifecycle' }, { id: 'wrong' },
    ...['/abs/file', 'C:/file', '../file', 'src/../file', 'src\\file'].map(path => ({ target: { path } })),
    { target: { path: 'src/file', startLine: 2, endLine: 1 } },
    { target: { path: 'src/file', endLine: 1 } },
    ...['prompt', 'command', 'output'].map(key => ({ [key]: 'secret' })),
    { target: { path: 'src/file', output: 'secret' } },
    ...['Read file', 'shell;whoami', 'shell|cat', 'shell$(id)'].map(tool => ({ tool })),
  ])('rejects invalid or unsanitized entry %j', patch => {
    expect(RunActivitySchema.safeParse({ ...entry, ...patch }).success).toBe(false);
  });

  it('bounds snapshots to 50 entries', () => {
    expect(RunActivitySummarySchema.parse(summary)).toEqual(summary);
    expect(RunActivitySummarySchema.safeParse({ ...summary, recent: Array(51).fill(entry) }).success).toBe(false);
  });
});
