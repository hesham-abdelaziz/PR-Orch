import type { ReviewerRunRecord } from '../reviews/entities/reviewer-run.entity.js';
import { describe, expect, it } from 'vitest';

import { jobRecord, uuid } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { InMemoryReviewRepository } from '../reviews/in-memory-review.repository.js';
import { ReportQueryService, ReviewHistoryQuerySchema } from './report-query.service.js';

function runFor(jobId: string, provider: 'codex' | 'gemini', state: ReviewerRunRecord['state'] = 'completed'): ReviewerRunRecord {
  return {
    id: uuid(),
    jobId,
    role: 'reviewer',
    selection: { provider, model: 'm' },
    state,
    startedAt: '2026-09-29T10:00:00.000Z',
    completedAt: '2026-09-29T10:05:00.000Z',
    warning: null,
    attempts: 1,
    sanitizedLog: 'log',
    result: null,
  };
}

async function seeded() {
  const repository = new InMemoryReviewRepository();
  const service = new ReportQueryService(repository);
  const done = jobRecord({ state: 'completed', createdAt: '2026-09-27T10:00:00.000Z', completedAt: '2026-09-27T10:20:00.000Z', overallRisk: 'high', findingCount: 2 });
  const failed = jobRecord({ state: 'failed', createdAt: '2026-09-28T10:00:00.000Z', failureReason: 'All reviewers failed.' });
  const partial = jobRecord({ state: 'completed', createdAt: '2026-09-29T10:00:00.000Z', overallRisk: 'clean', findingCount: 0, warnings: ['Reviewer failed'] });
  for (const record of [done, failed, partial]) {
    await repository.createJob(record);
    await repository.saveRun(runFor(record.id, 'codex'));
    await repository.saveRun(runFor(record.id, 'gemini', 'failed'));
  }

  return { repository, service, done, failed, partial };
}

describe('ReportQueryService', () => {
  it('maps a stored job and its runs to the shared ReviewJob shape', async () => {
    const { service, done } = await seeded();

    const review = await service.getReview(done.id);

    expect(review).toMatchObject({ id: done.id, state: 'completed', main: done.main });
    expect(review?.reviewers.map((run) => run.selection.provider)).toEqual(['codex', 'gemini']);
    expect(review?.reviewers[1]).toMatchObject({ state: 'failed' });
  });

  it('returns null for unknown reviews', async () => {
    const { service } = await seeded();

    expect(await service.getReview('00000000-0000-4000-8000-00000000ffff')).toBeNull();
  });

  it('lists history newest first with derived status, risk, and finding count', async () => {
    const { service, done, failed, partial } = await seeded();

    const page = await service.listReviews(ReviewHistoryQuerySchema.parse({}));

    expect(page.items.map((item) => item.review.id)).toEqual([partial.id, failed.id, done.id]);
    expect(page.items.map((item) => item.status)).toEqual(['completed_with_warnings', 'failed', 'completed']);
    expect(page.items.map((item) => item.overallRisk)).toEqual(['clean', null, 'high']);
    expect(page.items.map((item) => item.findingCount)).toEqual([0, null, 2]);
    expect(page.nextCursor).toBeNull();
  });

  it('filters by repository, provider, status, risk, date, and text', async () => {
    const { service, done, failed } = await seeded();
    const ids = async (query: Record<string, unknown>) =>
      (await service.listReviews(ReviewHistoryQuerySchema.parse(query))).items.map((item) => item.review.id);

    expect(await ids({ status: 'failed' })).toEqual([failed.id]);
    expect(await ids({ risk: 'high' })).toEqual([done.id]);
    expect(await ids({ repository: 'SHOP/WEB' })).toHaveLength(3);
    expect(await ids({ repository: 'nothing' })).toEqual([]);
    expect(await ids({ provider: 'claude' })).toHaveLength(3);
    expect(await ids({ from: '2026-09-28T00:00:00.000Z' })).toHaveLength(2);
    expect(await ids({ to: '2026-09-27T23:59:59.000Z' })).toEqual([done.id]);
    expect(await ids({ q: 'configuration loader' })).toHaveLength(3);
  });

  it('pages with an opaque cursor', async () => {
    const { service } = await seeded();

    const first = await service.listReviews(ReviewHistoryQuerySchema.parse({ limit: 2 }));
    const second = await service.listReviews(ReviewHistoryQuerySchema.parse({ limit: 2, cursor: first.nextCursor ?? '' }));

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects malformed history queries', () => {
    for (const bad of [{ limit: 0 }, { limit: 101 }, { status: 'weird' }, { provider: 'gpt' }, { from: 'yesterday' }, { unknown: 1 }]) {
      expect(ReviewHistoryQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(ReviewHistoryQuerySchema.parse({}).limit).toBe(25);
  });

  it('serves the active review or null', async () => {
    const repository = new InMemoryReviewRepository();
    const service = new ReportQueryService(repository);
    expect(await service.getActiveReview()).toBeNull();

    const active = jobRecord({ state: 'reviewing' });
    await repository.createJob(active);
    await repository.saveRun(runFor(active.id, 'codex', 'running'));

    expect(await service.getActiveReview()).toMatchObject({ id: active.id, state: 'reviewing' });
  });

  it('has no report or markdown for reviews that did not complete', async () => {
    const { service, failed } = await seeded();

    expect(await service.getReportMarkdown(failed.id)).toBeNull();
    expect(await service.getReport(failed.id)).toBeNull();
    expect(await service.getReportMarkdown('00000000-0000-4000-8000-00000000ffff')).toBeNull();
  });

  it('returns a stored markdown report with a stable download filename', async () => {
    const repository = new InMemoryReviewRepository();
    const service = new ReportQueryService(repository);
    const created = await repository.createJob(jobRecord({ state: 'rendering' }));
    if (!created.created) throw new Error('unreachable');
    const report = {
      jobId: created.job.id,
      report: { reviewId: created.job.id, executiveSummary: 's', overallRisk: 'clean' as const, findings: [], decisions: [], acceptedCount: 0, rejectedCount: 0, mergedCount: 0, warnings: [], exclusions: [] },
      markdown: '# stored report',
      durationMs: 10,
      createdAt: '2026-09-29T10:20:00.000Z',
    };
    await repository.completeJob({ jobId: created.job.id, report, finalFindings: [], at: report.createdAt });

    const first = await service.getReportMarkdown(created.job.id);
    expect(first).toEqual({ markdown: '# stored report', filename: `review-${created.job.id}.md` });
    const structured = await service.getReport(created.job.id);
    if (!structured) throw new Error('unreachable');
    structured.executiveSummary = 'tampered';

    expect((await service.getReport(created.job.id))?.executiveSummary).toBe('s');
  });
});
