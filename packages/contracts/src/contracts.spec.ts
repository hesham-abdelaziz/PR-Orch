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
  assertModelSelectionSupported,
  getSupportedReasoningEfforts,
  isReasoningEffortSupported,
} from './index.js';

const reviewer = { provider: 'codex', model: 'gpt-codex' } as const;

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
