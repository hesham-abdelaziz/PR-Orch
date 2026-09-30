import { DEFAULT_SETTINGS, type ReviewFinding, type Settings } from '@pr-orchestrator/contracts';
import type { PullRequestSummary } from '@pr-orchestrator/contracts';

import type { ReviewJobRecord } from '../../../apps/api/src/reviews/entities/review-job.entity.js';

let counter = 0;

/** Deterministic RFC 4122 v4-shaped UUIDs for tests. */
export function uuid(seed?: number): string {
  counter += 1;
  const value = (seed ?? counter).toString(16).padStart(12, '0');

  return `00000000-0000-4000-8000-${value}`;
}

export function pullRequest(overrides: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    url: 'https://dev.azure.com/acme/shop/_git/web/pullrequest/42',
    organization: 'acme',
    project: 'shop',
    repository: 'web',
    pullRequestId: 42,
    title: 'Add configuration loader',
    author: { id: 'u-1', displayName: 'Dana Developer' },
    sourceBranch: 'refs/heads/feature/loader',
    targetBranch: 'refs/heads/main',
    sourceCommit: 'a'.repeat(40),
    targetCommit: 'b'.repeat(40),
    changedFiles: 4,
    additions: 120,
    deletions: 7,
    updatedAt: '2026-09-29T09:00:00.000Z',
    ...overrides,
  };
}

export function settings(overrides: Partial<Settings> = {}): Settings {
  return structuredClone({ ...DEFAULT_SETTINGS, ...overrides }) as Settings;
}

export function jobRecord(overrides: Partial<ReviewJobRecord> = {}): ReviewJobRecord {
  return {
    id: uuid(),
    state: 'queued',
    pullRequest: pullRequest(),
    main: { provider: 'claude', model: 'opus' },
    reviewers: [
      { provider: 'codex', model: 'cli-default' },
      { provider: 'gemini', model: 'pro' },
    ],
    additionalInstructions: null,
    standards: null,
    standardsStoragePath: null,
    settings: settings(),
    warnings: [],
    exclusions: [],
    failureReason: null,
    workspaceId: null,
    cleanupPending: false,
    overallRisk: null,
    findingCount: null,
    eventSequence: 0,
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

export function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: uuid(),
    title: 'Unchecked null dereference in loader',
    severity: 'high',
    filePath: 'src/loader.ts',
    location: { startLine: 12, endLine: 14 },
    evidence: 'Line 12 reads config.value without a null check.',
    impact: 'The loader throws for empty configuration.',
    suggestedFix: 'Guard config before reading value.',
    origins: [{ provider: 'codex', model: 'cli-default' }],
    ...overrides,
  };
}
