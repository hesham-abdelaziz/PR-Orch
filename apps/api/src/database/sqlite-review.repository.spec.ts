import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { finding, jobRecord, uuid } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { ReviewEventsService } from '../reviews/review-events.service.js';
import { toReviewJob } from '../reviews/review-job.mapper.js';
import { createPlatformDataSource } from './data-source.js';
import { SqliteReviewRepository } from './sqlite-review.repository.js';

describe('durable review repository', () => {
  let directory: string;
  let db: DataSource;
  let repository: SqliteReviewRepository;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'review-store-'));
    db = await createPlatformDataSource(join(directory, 'db.sqlite')).initialize();
    await db.runMigrations();
    repository = new SqliteReviewRepository(db);
  });
  afterEach(async () => { if (db.isInitialized) await db.destroy(); await rm(directory, { recursive: true, force: true }); });

  it('inserts job and runs atomically and leaves no loser rows', async () => {
    const a = jobRecord(); const b = jobRecord();
    const run = { id: uuid(), jobId: a.id, role: 'reviewer' as const, selection: a.reviewers[0]!, state: 'queued' as const, startedAt: null, completedAt: null, warning: null, attempts: 0, sanitizedLog: '', result: null };
    const outcomes = await Promise.all([repository.createJob(a, [run]), repository.createJob(b, [{ ...run, id: uuid(), jobId: b.id }])]);
    expect(outcomes).toEqual([expect.objectContaining({ created: true }), { created: false, activeJobId: a.id }]);
    expect(await repository.listRuns(a.id)).toEqual([run]);
    expect(await repository.getJob(b.id)).toBeNull();
    expect(await repository.listRuns(b.id)).toEqual([]);
  });
  it('rolls back job creation if a run cannot be inserted', async () => {
    const a = jobRecord();
    await expect(repository.createJob(a, [{ id: uuid(), jobId: 'missing' } as never])).rejects.toThrow();
    expect(await repository.getJob(a.id)).toBeNull();
  });
  it('compares state atomically and ignores forged sequence and state patches', async () => {
    const job = jobRecord(); await repository.createJob(job);
    await repository.allocateEventSequence(job.id);
    await repository.updateJob(job.id, { eventSequence: 0, state: 'completed', warnings: ['warning'] } as never, 'later');
    const results = await Promise.all(['preparing', 'cancelling'].map(to => repository.transitionJob({ jobId: job.id, expectedFrom: 'queued', to: to as 'preparing', at: 'later', patch: { eventSequence: 0 } as never })));
    expect(results.map(r => r.applied)).toEqual([true, false]);
    expect(await repository.getJob(job.id)).toMatchObject({ eventSequence: 1, state: 'preparing', warnings: ['warning'] });
  });
  it('rejects cross-job run identities, candidate references and completion records', async () => {
    const old = jobRecord({ state: 'failed' });
    const run = { id: uuid(), jobId: old.id, role: 'reviewer' as const, selection: old.reviewers[0]!, state: 'queued' as const, startedAt: null, completedAt: null, warning: null, attempts: 0, sanitizedLog: '', result: null };
    await repository.createJob(old, [run]);
    const job = jobRecord({ state: 'rendering' });
    await expect(repository.createJob(job, [{ ...run, sanitizedLog: 'overwritten' }])).rejects.toThrow();
    expect(await repository.getJob(job.id)).toBeNull();
    expect(await repository.listRuns(old.id)).toEqual([run]);
    await repository.createJob(job);
    await expect(repository.saveRun({ ...run, jobId: job.id })).rejects.toThrow();
    await expect(repository.saveCandidates([{ id: uuid(), jobId: job.id, runId: run.id, finding: finding() }])).rejects.toThrow();
    const report = { jobId: old.id, report: {}, markdown: 'bad', durationMs: 1, createdAt: job.createdAt };
    await expect(repository.completeJob({ jobId: job.id, report, finalFindings: [], at: job.createdAt } as never)).rejects.toThrow();
    await expect(repository.completeJob({ jobId: job.id, report: { ...report, jobId: job.id }, finalFindings: [{ id: 'f', jobId: old.id, finding: {}, decision: {}, verification: {} }], at: job.createdAt } as never)).rejects.toThrow();
    expect((await repository.getJob(job.id))?.state).toBe('rendering');
    expect(await repository.getReport(old.id)).toBeNull();
    expect(await repository.getReport(job.id)).toBeNull();
  });
  it('allocates unique sequences from two connections and retains them after restart and terminal state', async () => {
    const job = jobRecord(); await repository.createJob(job);
    const other = await createPlatformDataSource(join(directory, 'db.sqlite')).initialize();
    try {
      const second = new SqliteReviewRepository(other);
      const values = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? second : repository).allocateEventSequence(job.id)));
      expect(values).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      await repository.transitionJob({ jobId: job.id, expectedFrom: 'queued', to: 'completed', at: 'later' });
    } finally { await other.destroy(); }
    await db.destroy();
    db = await createPlatformDataSource(join(directory, 'db.sqlite')).initialize();
    repository = new SqliteReviewRepository(db);
    const events = new ReviewEventsService(repository);
    const snapshot = await firstValueFrom(events.stream(job.id, async () => toReviewJob((await repository.getJob(job.id))!, [])));
    expect(snapshot.sequence).toBe(20);
    expect(await repository.allocateEventSequence(job.id)).toBe(21);
    expect(await repository.allocateEventSequence('absent')).toBeNull();
    expect(await repository.getEventSequence('absent')).toBeNull();
  });
  it('completes once with immutable report and persisted verification audit', async () => {
    const job = jobRecord({ state: 'rendering' }); await repository.createJob(job);
    const f = finding();
    const verification = { candidates: [], relocated: false, locationCorrection: null, evidenceLine: 1, severityChanged: false };
    const report = { jobId: job.id, report: { reviewId: job.id, executiveSummary: 'ok', overallRisk: 'clean' as const, findings: [], decisions: [], acceptedCount: 0, rejectedCount: 0, mergedCount: 0, warnings: [], exclusions: [] }, markdown: '# Canonical', durationMs: 10, createdAt: job.createdAt };
    const input = { jobId: job.id, report, finalFindings: [{ id: f.id, jobId: job.id, finding: f, decision: { candidateIds: [f.id], verdict: 'accepted' as const, rationale: 'code', finding: f }, verification }], at: job.createdAt };
    expect((await repository.completeJob(input)).applied).toBe(true);
    expect((await repository.completeJob({ ...input, report: { ...report, markdown: 'tampered' } })).applied).toBe(false);
    expect((await repository.getReport(job.id))?.markdown).toBe('# Canonical');
    const rows = await db.query('SELECT verification FROM final_findings WHERE job_id=?', [job.id]);
    expect(JSON.parse(rows[0].verification)).toEqual(verification);
  });
  it('rolls back completion including its state when a final finding insert fails', async () => {
    const job = jobRecord({ state: 'rendering' }); await repository.createJob(job);
    const report = { jobId: job.id, report: {}, markdown: 'text', durationMs: 1, createdAt: job.createdAt };
    await expect(repository.completeJob({ jobId: job.id, report, finalFindings: [{ id: 'f', jobId: 'missing', finding: {}, decision: {}, verification: {} }], at: job.createdAt } as never)).rejects.toThrow();
    expect((await repository.getJob(job.id))?.state).toBe('rendering');
    expect(await repository.getReport(job.id)).toBeNull();
  });
  it('uses keyset pagination even after the cursor job disappears and escapes wildcard filters', async () => {
    for (const [id, title] of [['a', '100% fix'], ['b', 'plain'], ['c', 'plain']] as const) await repository.createJob(jobRecord({ id, state: 'completed', pullRequest: { ...jobRecord().pullRequest, title } }));
    const page = await repository.queryJobs({}, { limit: 1 });
    expect(page.items[0]?.id).toBe('c');
    await db.query('DELETE FROM review_jobs WHERE id=?', ['c']);
    expect((await repository.queryJobs({}, { limit: 1, cursor: page.nextCursor! })).items[0]?.id).toBe('b');
    expect((await repository.queryJobs({ text: '%' }, { limit: 10 })).items.map(j => j.id)).toEqual(['a']);
  });
});
