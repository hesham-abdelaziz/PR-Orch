import { describe, expect, it } from 'vitest';

import {
  CreateReviewRequestSchema,
  JobStateSchema,
  ProviderStatusSchema,
  ReviewEventSchema,
  ReviewFindingSchema,
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
