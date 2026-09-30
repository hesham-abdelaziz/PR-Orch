import { describe, expect, it } from 'vitest';

import { finding, jobRecord, uuid } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';

describe('InMemoryReviewRepository', () => {
  it('creates at most one non-terminal job even for concurrent inserts', async () => {
    const repository = new InMemoryReviewRepository();

    const results = await Promise.all(
      Array.from({ length: 10 }, () => repository.createJob(jobRecord())),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    const loser = results.find((result) => !result.created);
    const winner = results.find((result) => result.created);
    expect(loser).toMatchObject({ created: false, activeJobId: winner?.created ? winner.job.id : '' });
  });

  it('allows a new job once the active job is terminal', async () => {
    const repository = new InMemoryReviewRepository();
    const first = await repository.createJob(jobRecord());
    if (!first.created) throw new Error('unreachable');

    await repository.transitionJob({
      jobId: first.job.id,
      expectedFrom: 'queued',
      to: 'failed',
      at: '2026-09-29T10:01:00.000Z',
    });

    expect((await repository.createJob(jobRecord())).created).toBe(true);
  });

  it('applies transitions only when the expected state still matches', async () => {
    const repository = new InMemoryReviewRepository();
    const created = await repository.createJob(jobRecord());
    if (!created.created) throw new Error('unreachable');
    const id = created.job.id;
    const at = '2026-09-29T10:01:00.000Z';

    const first = await repository.transitionJob({ jobId: id, expectedFrom: 'queued', to: 'preparing', at });
    const stale = await repository.transitionJob({ jobId: id, expectedFrom: 'queued', to: 'cancelling', at });

    expect(first.applied).toBe(true);
    expect(stale).toMatchObject({ applied: false, job: { state: 'preparing' } });
  });

  it('stamps completedAt on terminal transitions only', async () => {
    const repository = new InMemoryReviewRepository();
    const created = await repository.createJob(jobRecord());
    if (!created.created) throw new Error('unreachable');
    const id = created.job.id;

    const active = await repository.transitionJob({
      jobId: id,
      expectedFrom: 'queued',
      to: 'preparing',
      at: '2026-09-29T10:01:00.000Z',
    });
    const failed = await repository.transitionJob({
      jobId: id,
      expectedFrom: 'preparing',
      to: 'failed',
      patch: { failureReason: 'boom' },
      at: '2026-09-29T10:02:00.000Z',
    });

    expect(active.applied && active.job.completedAt).toBeNull();
    expect(failed.applied && failed.job).toMatchObject({
      completedAt: '2026-09-29T10:02:00.000Z',
      failureReason: 'boom',
    });
  });

  it('returns copies so callers cannot mutate stored rows', async () => {
    const repository = new InMemoryReviewRepository();
    const created = await repository.createJob(jobRecord());
    if (!created.created) throw new Error('unreachable');

    const fetched = await repository.getJob(created.job.id);
    if (!fetched) throw new Error('unreachable');
    fetched.warnings.push('tampered');
    fetched.state = 'completed';

    expect(await repository.getJob(created.job.id)).toMatchObject({ state: 'queued', warnings: [] });
  });

  it('stores a report only through completeJob and never twice', async () => {
    const repository = new InMemoryReviewRepository();
    const created = await repository.createJob(jobRecord({ state: 'rendering' }));
    if (!created.created) throw new Error('unreachable');
    const id = created.job.id;
    const report = {
      jobId: id,
      report: {
        reviewId: id,
        executiveSummary: 'ok',
        overallRisk: 'clean' as const,
        findings: [],
        decisions: [],
        acceptedCount: 0,
        rejectedCount: 0,
        mergedCount: 0,
        warnings: [],
        exclusions: [],
      },
      markdown: '# report',
      durationMs: 5,
      createdAt: '2026-09-29T10:05:00.000Z',
    };

    const first = await repository.completeJob({ jobId: id, report, finalFindings: [], at: report.createdAt });
    const second = await repository.completeJob({ jobId: id, report: { ...report, markdown: '# other' }, finalFindings: [], at: report.createdAt });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect((await repository.getReport(id))?.markdown).toBe('# report');
  });

  it('refuses completeJob unless the job is rendering', async () => {
    const repository = new InMemoryReviewRepository();
    const created = await repository.createJob(jobRecord({ state: 'cancelling' }));
    if (!created.created) throw new Error('unreachable');

    const result = await repository.completeJob({
      jobId: created.job.id,
      report: {
        jobId: created.job.id,
        report: {
          reviewId: created.job.id,
          executiveSummary: 'ok',
          overallRisk: 'clean',
          findings: [],
          decisions: [],
          acceptedCount: 0,
          rejectedCount: 0,
          mergedCount: 0,
          warnings: [],
          exclusions: [],
        },
        markdown: '# r',
        durationMs: 1,
        createdAt: '2026-09-29T10:05:00.000Z',
      },
      finalFindings: [],
      at: '2026-09-29T10:05:00.000Z',
    });

    expect(result).toMatchObject({ applied: false, job: { state: 'cancelling' } });
    expect(await repository.getReport(created.job.id)).toBeNull();
  });

  it('upserts runs and lists candidates per job', async () => {
    const repository = new InMemoryReviewRepository();
    const run = {
      id: '00000000-0000-4000-8000-0000000000a1',
      jobId: 'job-1',
      role: 'reviewer' as const,
      selection: { provider: 'codex' as const, model: 'm' },
      state: 'queued' as const,
      startedAt: null,
      completedAt: null,
      warning: null,
      attempts: 0,
      sanitizedLog: '',
      result: null,
    };

    await repository.saveRun(run);
    await repository.saveRun({ ...run, state: 'running' });
    await repository.saveCandidates([{ id: 'c1', jobId: 'job-1', runId: run.id, finding: finding() }]);

    expect(await repository.listRuns('job-1')).toEqual([{ ...run, state: 'running' }]);
    expect(await repository.listCandidates('job-1')).toHaveLength(1);
    expect(await repository.listCandidates('other')).toHaveLength(0);
  });

  it('filters and pages history newest first', async () => {
    const repository = new InMemoryReviewRepository();
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const record = jobRecord({
        state: 'completed',
        createdAt: `2026-09-2${index}T10:00:00.000Z`,
        overallRisk: index % 2 === 0 ? 'high' : 'clean',
        pullRequest: { ...jobRecord().pullRequest, repository: index === 4 ? 'api' : 'web', title: `PR number ${index}` },
        warnings: index === 1 ? ['partial'] : [],
      });
      ids.push(record.id);
      await repository.createJob(record);
    }

    const all = await repository.queryJobs({}, { limit: 2 });
    expect(all.items.map((item) => item.id)).toEqual([ids[4], ids[3]]);
    expect(all.nextCursor).not.toBeNull();

    const second = await repository.queryJobs({}, { limit: 2, cursor: all.nextCursor ?? '' });
    expect(second.items.map((item) => item.id)).toEqual([ids[2], ids[1]]);

    expect((await repository.queryJobs({ repository: 'API' }, { limit: 10 })).items.map((item) => item.id)).toEqual([ids[4]]);
    expect((await repository.queryJobs({ risk: 'clean' }, { limit: 10 })).items).toHaveLength(2);
    expect((await repository.queryJobs({ status: 'completed_with_warnings' }, { limit: 10 })).items.map((item) => item.id)).toEqual([ids[1]]);
    expect((await repository.queryJobs({ status: 'completed' }, { limit: 10 })).items).toHaveLength(4);
    expect((await repository.queryJobs({ provider: 'gemini' }, { limit: 10 })).items).toHaveLength(5);
    expect((await repository.queryJobs({ text: 'number 3' }, { limit: 10 })).items.map((item) => item.id)).toEqual([ids[3]]);
    expect(
      (await repository.queryJobs({ from: '2026-09-22T00:00:00.000Z', to: '2026-09-23T23:59:59.000Z' }, { limit: 10 })).items,
    ).toHaveLength(2);
  });

  it('stores the initial runs together with the job, and none when the insert loses', async () => {
    const repository = new InMemoryReviewRepository();
    const winner = jobRecord();
    const loser = jobRecord();
    const run = (jobId: string) => ({
      id: uuid(),
      jobId,
      role: 'reviewer' as const,
      selection: { provider: 'codex' as const, model: 'm' },
      state: 'queued' as const,
      startedAt: null,
      completedAt: null,
      warning: null,
      attempts: 0,
      sanitizedLog: '',
      result: null,
    });

    await repository.createJob(winner, [run(winner.id)]);
    const lost = await repository.createJob(loser, [run(loser.id)]);

    expect(lost.created).toBe(false);
    expect(await repository.listRuns(winner.id)).toHaveLength(1);
    expect(await repository.listRuns(loser.id)).toHaveLength(0);
  });

  it('lists only terminal jobs as pending cleanup, never one that is still running', async () => {
    const repository = new InMemoryReviewRepository();
    const created = await repository.createJob(jobRecord({ cleanupPending: true, workspaceId: 'ws-1' }));
    if (!created.created) throw new Error('unreachable');

    expect(await repository.listJobsPendingCleanup()).toEqual([]);

    await repository.transitionJob({ jobId: created.job.id, expectedFrom: 'queued', to: 'failed', at: '2026-09-29T10:01:00.000Z' });

    expect((await repository.listJobsPendingCleanup()).map((job) => job.id)).toEqual([created.job.id]);
  });
});
