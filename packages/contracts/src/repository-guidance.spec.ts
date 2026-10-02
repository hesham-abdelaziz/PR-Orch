import { describe, expect, it } from 'vitest';
import { CreateReviewRequestSchema, ReviewJobSchema, ReviewEventSchema, VerifiedReportSchema, RepositoryGuidanceSchema, RepositoryGuidanceSnapshotSchema, RepositoryGuidanceMetadataSchema, REPOSITORY_GUIDANCE_MAX_BYTES } from './index.js';

const request = { pullRequestUrl: 'https://example.com/pr/1', main: { provider: 'claude', model: 'opus' }, reviewers: [{ provider: 'codex', model: 'cli-default' }] };
const at = '2026-10-02T00:00:00.000Z';
const id = '00000000-0000-4000-8000-000000000001';
const job = {
  id, state: 'queued', main: request.main, reviewers: [{ id, selection: request.reviewers[0], state: 'queued', startedAt: null, completedAt: null, warning: null }],
  standards: null, warnings: [], createdAt: at, updatedAt: at, completedAt: null,
  pullRequest: { url: request.pullRequestUrl, organization: 'org', project: 'project', repository: 'repo', pullRequestId: 1, title: 'PR', author: { id: 'user', displayName: 'User' }, sourceBranch: 'feature', targetBranch: 'main', sourceCommit: 'abcdef0', targetCommit: 'abcdef1', changedFiles: 1, additions: 1, deletions: 0, updatedAt: at },
};

describe('per-review repository guidance', () => {
  it.each(['Claude.md', 'AGENTS.MD', 'GEMINI.Txt', '指南.md'])('preserves UTF-8 guidance %s without trimming', filename => {
    const repositoryGuidance = { filename, content: '\t# Guidance\r\nReview café 😀.\n' };
    expect(CreateReviewRequestSchema.parse({ ...request, repositoryGuidance }).repositoryGuidance).toEqual(repositoryGuidance);
  });

  it('accepts 64 KiB and counts UTF-8 bytes rather than characters', () => {
    for (const content of ['x'.repeat(65_536), 'é'.repeat(32_768), '😀'.repeat(16_384)]) {
      expect(CreateReviewRequestSchema.safeParse({ ...request, repositoryGuidance: { filename: 'a.md', content } }).success).toBe(true);
      expect(CreateReviewRequestSchema.safeParse({ ...request, repositoryGuidance: { filename: 'a.md', content: content + 'x' } }).success).toBe(false);
    }
  });

  it.each(['', '.', '..', '../AGENTS.md', 'dir/AGENTS.md', 'dir\\AGENTS.md', '..hidden.md', 'C:AGENTS.md', 'a.md\n', 'a\u0000.md', 'a\u007f.md', 'a\u0085.md', '\ud800.md', '\udc00.txt', 'a.pdf'])('rejects unsafe filename %j', filename => {
    expect(CreateReviewRequestSchema.safeParse({ ...request, repositoryGuidance: { filename, content: 'review' } }).success).toBe(false);
  });

  it.each(['', ' \t\r\n', 'a\u0000b', 'a\u0001b', 'a\u007fb', 'a\u0085b', '\ud800', '\udc00', 'x\ud800x'])('rejects empty or invalid content %j', content => {
    expect(CreateReviewRequestSchema.safeParse({ ...request, repositoryGuidance: { filename: 'a.md', content } }).success).toBe(false);
  });

  it('keeps old requests and jobs compatible and accepts nullable metadata', () => {
    expect(CreateReviewRequestSchema.parse(request)).toEqual(request);
    expect(ReviewJobSchema.parse(job)).toEqual(job);
    for (const repositoryGuidance of [null, { filename: 'a.md', sha256: 'a'.repeat(64), sizeBytes: 1 }]) {
      expect(ReviewJobSchema.parse({ ...job, repositoryGuidance }).repositoryGuidance).toEqual(repositoryGuidance);
    }
    expect(VerifiedReportSchema.safeParse({ reviewId: id, executiveSummary: 'Legacy', overallRisk: 'clean', findings: [], decisions: [], acceptedCount: 0, rejectedCount: 0, mergedCount: 0, warnings: [], exclusions: [] }).success).toBe(true);
  });

  it('rejects content in public jobs and SSE snapshots', () => {
    const publicJob = { ...job, repositoryGuidance: { filename: 'a.md', content: 'private guidance', sha256: 'a'.repeat(64), sizeBytes: 16 } };
    expect(ReviewJobSchema.safeParse(publicJob).success).toBe(false);
    expect(ReviewEventSchema.safeParse({ reviewId: id, sequence: 1, emittedAt: at, type: 'job.snapshot', payload: { job: publicJob } }).success).toBe(false);
  });

  it('exports independent attachment, snapshot and metadata contracts', () => {
    const metadata = { filename: 'AGENTS.md', sha256: 'a'.repeat(64), sizeBytes: 5 };
    const attachment = { filename: metadata.filename, content: 'café' };
    expect(RepositoryGuidanceSchema.parse(attachment)).toEqual(attachment);
    expect(RepositoryGuidanceMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(RepositoryGuidanceSnapshotSchema.parse({ ...attachment, ...metadata })).toEqual({ ...attachment, ...metadata });
    expect(RepositoryGuidanceSnapshotSchema.safeParse({ ...attachment, ...metadata, sizeBytes: 4 }).success).toBe(false);
    expect(RepositoryGuidanceSchema.safeParse({ ...attachment, sha256: metadata.sha256 }).success).toBe(false);
    for (const patch of [{ sha256: 'invalid' }, { sizeBytes: 0 }, { sizeBytes: 1.5 }, { sizeBytes: REPOSITORY_GUIDANCE_MAX_BYTES + 1 }, { content: 'private' }]) {
      expect(RepositoryGuidanceMetadataSchema.safeParse({ ...metadata, ...patch }).success).toBe(false);
    }
  });
});
