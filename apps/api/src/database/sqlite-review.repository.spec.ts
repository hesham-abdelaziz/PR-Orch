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

  it('round-trips an immutable guidance snapshot after reopening without exposing content', async () => {
    const snapshot = { filename: 'AGENTS.md', content: 'Review café 😀.\r\n', sha256: 'a'.repeat(64), sizeBytes: 20 };
    const job = { ...jobRecord(), repositoryGuidance: snapshot };
    await repository.createJob(job);
    snapshot.content = 'changed by caller';
    await repository.updateJob(job.id, { repositoryGuidance: null } as never, job.updatedAt);
    await repository.transitionJob({ jobId: job.id, expectedFrom: 'queued', to: 'preparing', at: job.updatedAt, patch: { repositoryGuidance: null } as never });
    await db.destroy();
    db = await createPlatformDataSource(join(directory, 'db.sqlite')).initialize();
    repository = new SqliteReviewRepository(db);
    const stored = (await repository.getJob(job.id))!;
    expect(stored).toMatchObject({ repositoryGuidance: { filename: 'AGENTS.md', content: 'Review café 😀.\r\n', sha256: 'a'.repeat(64), sizeBytes: 20 } });
    expect(JSON.stringify(toReviewJob(stored, []))).not.toContain('Review café');
    const events = new ReviewEventsService(repository);
    const event = await firstValueFrom(events.stream(job.id, async () => toReviewJob((await repository.getJob(job.id))!, [])));
    expect(JSON.stringify(event)).not.toContain('Review café');
    const retrieved = stored as typeof job;
    retrieved.repositoryGuidance.content = 'changed after retrieval';
    expect((await repository.getJob(job.id)) as typeof job).toMatchObject({ repositoryGuidance: { content: 'Review café 😀.\r\n' } });
  });

  it('defaults legacy records without guidance to null', async () => {
    const job = jobRecord();
    await repository.createJob(job);
    expect(await repository.getJob(job.id)).toMatchObject({ repositoryGuidance: null });
  });

  it('inserts job and runs atomically and leaves no loser rows', async () => {
    const a = jobRecord(); const b = jobRecord();
    const run = { id: uuid(), jobId: a.id, role: 'reviewer' as const, selection: a.reviewers[0]!, state: 'queued' as const, startedAt: null, completedAt: null, warning: null, attempts: 0, sanitizedLog: '', result: null };
    const outcomes = await Promise.all([repository.createJob(a, [run]), repository.createJob(b, [{ ...run, id: uuid(), jobId: b.id }])]);
    expect(outcomes).toEqual([expect.objectContaining({ created: true }), { created: false, activeJobId: a.id }]);
    expect(await repository.listRuns(a.id)).toEqual([{ ...run, activity: { visibility: null, count: 0, lastActivityAt: null } }]);
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
    expect(await repository.listRuns(old.id)).toEqual([{ ...run, activity: { visibility: null, count: 0, lastActivityAt: null } }]);
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
  it('persists reasoningEffort for main and reviewer runs and preserves backward compatibility with records lacking effort', async () => {
    const legacyJob = jobRecord({
      id: uuid(),
      main: { provider: 'claude', model: 'sonnet' },
      reviewers: [{ provider: 'codex', model: 'cli-default' }],
      state: 'completed',
    });
    const legacyRun = {
      id: uuid(),
      jobId: legacyJob.id,
      role: 'reviewer' as const,
      selection: { provider: 'codex' as const, model: 'cli-default' },
      state: 'completed' as const,
      startedAt: legacyJob.createdAt,
      completedAt: legacyJob.completedAt,
      warning: null,
      attempts: 1,
      sanitizedLog: 'done',
      result: null,
    };
    await repository.createJob(legacyJob, [legacyRun]);

    const retrievedLegacyJob = await repository.getJob(legacyJob.id);
    expect(retrievedLegacyJob?.main.reasoningEffort).toBeUndefined();
    const retrievedLegacyRuns = await repository.listRuns(legacyJob.id);
    expect(retrievedLegacyRuns[0]?.selection.reasoningEffort).toBeUndefined();

    const newJob = jobRecord({
      id: uuid(),
      main: { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' },
      reviewers: [
        { provider: 'codex', model: 'o3', reasoningEffort: 'medium' },
        { provider: 'gemini', model: 'pro', reasoningEffort: 'low' },
      ],
      state: 'completed',
    });
    const run1 = {
      id: uuid(),
      jobId: newJob.id,
      role: 'reviewer' as const,
      selection: { provider: 'codex' as const, model: 'o3', reasoningEffort: 'medium' as const },
      state: 'completed' as const,
      startedAt: newJob.createdAt,
      completedAt: newJob.completedAt,
      warning: null,
      attempts: 1,
      sanitizedLog: 'done',
      result: null,
    };
    const run2 = {
      id: uuid(),
      jobId: newJob.id,
      role: 'reviewer' as const,
      selection: { provider: 'gemini' as const, model: 'pro', reasoningEffort: 'low' as const },
      state: 'completed' as const,
      startedAt: newJob.createdAt,
      completedAt: newJob.completedAt,
      warning: null,
      attempts: 1,
      sanitizedLog: 'done',
      result: null,
    };
    await repository.createJob(newJob, [run1, run2]);

    const retrievedNewJob = await repository.getJob(newJob.id);
    expect(retrievedNewJob?.main.reasoningEffort).toBe('high');
    expect(retrievedNewJob?.reviewers[0]?.reasoningEffort).toBe('medium');
    expect(retrievedNewJob?.reviewers[1]?.reasoningEffort).toBe('low');

    const retrievedRuns = await repository.listRuns(newJob.id);
    expect(retrievedRuns[0]?.selection.reasoningEffort).toBe('medium');
    expect(retrievedRuns[1]?.selection.reasoningEffort).toBe('low');
  });
});
import type { RunActivityRecord } from '../reviews/entities/run-activity.entity.js';
import type { ReviewerRunRecord } from '../reviews/entities/reviewer-run.entity.js';

describe('durable run activity', () => {
  let db: DataSource;
  let repository: SqliteReviewRepository;
  let run: ReviewerRunRecord;
  let jobId: string;
  beforeEach(async () => {
    db = await createPlatformDataSource(':memory:').initialize();
    await db.runMigrations();
    repository = new SqliteReviewRepository(db);
    const job = jobRecord();
    jobId = job.id;
    run = { id: uuid(), jobId, role: 'reviewer', selection: job.reviewers[0]!, state: 'queued', startedAt: null, completedAt: null, warning: null, attempts: 0, sanitizedLog: '', result: null };
    await repository.createJob(job, [run]);
  });
  afterEach(async () => { if (db.isInitialized) await db.destroy(); });
  const at = (seq: number) => new Date(Date.UTC(2026, 8, 29, 12, 0, seq)).toISOString();
  const record = (run: ReviewerRunRecord, seq: number, kind: RunActivityRecord['kind'] = 'provider'): RunActivityRecord => ({
    jobId: run.jobId, runId: run.id, seq, at: at(seq), kind,
    payload: kind === 'provider' ? { action: 'reading_file', target: { path: 'src/auth.ts', startLine: 1 } } : kind === 'lifecycle' ? { action: 'attempt_ended', outcome: 'completed' } : { action: 'events_skipped', count: 1 },
  });

  it('appends and prunes while retaining provider activity bookkeeping', async () => {
    for (let seq = 1; seq <= 205; seq++) await repository.appendRunActivity(record(run, seq), 200);
    const entries = await repository.listRunActivityForRun(jobId, run.id, 200);
    expect(entries).toEqual(Array.from({ length: 200 }, (_, i) => record(run, i + 6)));
    expect((await repository.listRuns(jobId))[0]?.activity).toEqual({ visibility: null, count: 205, lastActivityAt: at(205) });
    await repository.appendRunActivity(record(run, 206, 'lifecycle'), 200);
    await repository.appendRunActivity(record(run, 207, 'notice'), 200);
    await repository.appendRunActivity({ ...record(run, 208), at: at(100) }, 200);
    expect((await repository.listRuns(jobId))[0]?.activity).toEqual({ visibility: null, count: 208, lastActivityAt: at(205) });
  });

  it('rolls back duplicate sequences and rejects unknown or cross-job runs', async () => {
    const original = record(run, 1);
    await repository.appendRunActivity(original, 200);
    await expect(repository.appendRunActivity({ ...record(run, 1), at: at(10) }, 0)).rejects.toThrow();
    await expect(repository.appendRunActivity({ ...record(run, 2), runId: uuid() }, 200)).rejects.toThrow();
    const other = jobRecord({ state: 'failed' });
    await repository.createJob(other);
    await expect(repository.appendRunActivity({ ...record(run, 2), jobId: other.id }, 200)).rejects.toThrow();
    expect(await repository.listRunActivityForRun(jobId, run.id, 200)).toEqual([original]);
    expect(await repository.listRunActivityForRun(other.id, run.id, 200)).toEqual([]);
    expect((await repository.listRuns(jobId))[0]?.activity).toEqual({ visibility: null, count: 1, lastActivityAt: at(1) });
  });

  it('preserves activity columns across saveRun and scopes visibility to job and run', async () => {
    await repository.setRunActivityVisibility(jobId, run.id, 'partial');
    await repository.appendRunActivity(record(run, 1), 200);
    await repository.setRunActivityVisibility(uuid(), run.id, 'full');
    await repository.saveRun({ ...run, state: 'completed', activity: { visibility: 'full', count: 0, lastActivityAt: null } });
    expect((await repository.listRuns(jobId))[0]).toMatchObject({ state: 'completed', activity: { visibility: 'partial', count: 1, lastActivityAt: at(1) } });
  });

  it('returns newest N per run ordered by run then ascending sequence', async () => {
    const second = { ...run, id: uuid(), role: 'verifier' as const };
    await repository.saveRun(second);
    for (const current of [run, second]) {
      for (let seq = 1; seq <= 4; seq++) await repository.appendRunActivity(record(current, seq), 200);
    }
    const runs = [run, second].sort((a, b) => a.id.localeCompare(b.id));
    expect(await repository.listRunActivity(jobId, 2)).toEqual(runs.flatMap(current => [record(current, 3), record(current, 4)]));
    expect(await repository.listRunActivityForRun(jobId, run.id, 2)).toEqual([record(run, 3), record(run, 4)]);
    expect(await repository.listRunActivityForRun(jobId, uuid(), 2)).toEqual([]);
    expect(await repository.listRunActivity(uuid(), 2)).toEqual([]);
    expect(await repository.listRunActivity(jobId, 0)).toEqual([]);
  });

  it('rejects payloads over the storage limit without changing bookkeeping', async () => {
    await expect(repository.appendRunActivity({ ...record(run, 1), payload: { action: 'tool_other', tool: 'x'.repeat(2048) } }, 200)).rejects.toThrow();
    expect(await repository.listRunActivityForRun(jobId, run.id, 200)).toEqual([]);
    expect((await repository.listRuns(jobId))[0]?.activity).toEqual({ visibility: null, count: 0, lastActivityAt: null });
  });
});
