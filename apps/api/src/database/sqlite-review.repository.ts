import type { Database } from 'better-sqlite3';
import type { ActivityVisibility } from '@pr-orchestrator/contracts';
import type { RunActivityRecord } from '../reviews/entities/run-activity.entity.js';
import type { DataSource } from 'typeorm';
import type { ReviewJobRecord, JobPatch } from '../reviews/entities/review-job.entity.js';
import type { ReviewerRunRecord } from '../reviews/entities/reviewer-run.entity.js';
import type { CandidateFindingRecord } from '../reviews/entities/candidate-finding.entity.js';
import type { ReportRecord } from '../reports/entities/report.entity.js';
import type { ReviewRepository, CreateJobResult, TransitionInput, TransitionResult, CompleteJobInput, ReviewHistoryFilter, HistoryPage } from '../reviews/review-repository.js';

type Row = Record<string, string | number | null>;
const terminal = "('completed','failed','cancelled')";
const columns = {
  id: 'id', state: 'state', eventSequence: 'event_sequence', pullRequest: 'pull_request', main: 'main', reviewers: 'reviewers',
  additionalInstructions: 'additional_instructions', standards: 'standards', standardsStoragePath: 'standards_storage_path',
  settings: 'settings', warnings: 'warnings', exclusions: 'exclusions', failureReason: 'failure_reason', workspaceId: 'workspace_id',
  cleanupPending: 'cleanup_pending', overallRisk: 'overall_risk', findingCount: 'finding_count', createdAt: 'created_at', updatedAt: 'updated_at', completedAt: 'completed_at',
} satisfies Record<keyof ReviewJobRecord, string>;
const jsonKeys = new Set(['pullRequest', 'main', 'reviewers', 'standards', 'settings', 'warnings', 'exclusions']);
const patchKeys = ['pullRequest', 'warnings', 'exclusions', 'failureReason', 'workspaceId', 'cleanupPending', 'overallRisk', 'findingCount'] as const;
const encode = (key: string, value: unknown): unknown => value === null || value === undefined ? null : jsonKeys.has(key) ? JSON.stringify(value) : key === 'cleanupPending' ? Number(value) : value;
function decode(row: Row | undefined): ReviewJobRecord | null {
  if (!row) return null;
  return Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[column] === null ? null : jsonKeys.has(key) ? JSON.parse(String(row[column])) : key === 'cleanupPending' ? Boolean(row[column]) : row[column]])) as unknown as ReviewJobRecord;
}

/** Uses the same SQLite connection as TypeORM migrations. Transactions are synchronous,
 * so async callers cannot interleave operations inside a transaction. Database constraints
 * also protect independent connections/processes. */
export class SqliteReviewRepository implements ReviewRepository {
  private readonly db: Database;
  constructor(source: DataSource) {
    this.db = (source.driver as unknown as { databaseConnection: Database }).databaseConnection;
  }
  async createJob(record: ReviewJobRecord, runs: ReviewerRunRecord[] = []): Promise<CreateJobResult> {
    try {
      return this.db.transaction(() => {
        const keys = Object.keys(columns) as (keyof ReviewJobRecord)[];
        this.db.prepare(`INSERT INTO review_jobs (${keys.map(k => columns[k]).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(k => encode(k, k === 'eventSequence' ? 0 : record[k])));
        for (const run of runs) {
          if (run.jobId !== record.id) throw new Error('Run belongs to a different job');
          this.putRun(run);
        }
        return { created: true, job: this.readJob(record.id)! } as const;
      }).immediate();
    } catch (error) {
      // Only the partial active-job index is an expected conflict. All other
      // constraint/database failures propagate after transaction rollback.
      if (error instanceof Error && error.message.includes("index 'ux_review_jobs_single_active'")) {
        const active = await this.getActiveJob();
        if (active) return { created: false, activeJobId: active.id };
      }
      throw error;
    }
  }
  private readJob(id: string) { return decode(this.db.prepare('SELECT * FROM review_jobs WHERE id=?').get(id) as Row | undefined); }
  async getJob(id: string) { return this.readJob(id); }
  async getActiveJob() { return decode(this.db.prepare(`SELECT * FROM review_jobs WHERE state NOT IN ${terminal} LIMIT 1`).get() as Row | undefined); }
  async listNonTerminalJobs() { return (this.db.prepare(`SELECT * FROM review_jobs WHERE state NOT IN ${terminal}`).all() as Row[]).map(row => decode(row)!); }
  async listJobsPendingCleanup() { return (this.db.prepare(`SELECT * FROM review_jobs WHERE state IN ${terminal} AND cleanup_pending=1`).all() as Row[]).map(row => decode(row)!); }
  private assignments(patch: JobPatch, at: string) {
    const keys = patchKeys.filter(k => patch[k] !== undefined);
    return { sql: [...keys.map(k => `${columns[k]}=?`), 'updated_at=?'].join(','), values: [...keys.map(k => encode(k, patch[k])), at] };
  }
  async updateJob(id: string, patch: JobPatch, at: string) {
    const changes = this.assignments(patch, at);
    return decode(this.db.prepare(`UPDATE review_jobs SET ${changes.sql} WHERE id=? RETURNING *`).get(...changes.values, id) as Row | undefined);
  }
  private transition(input: TransitionInput): TransitionResult {
    const changes = this.assignments(input.patch ?? {}, input.at);
    const row = this.db.prepare(`UPDATE review_jobs SET ${changes.sql}, state=?, completed_at=CASE WHEN ? IN ${terminal} THEN ? ELSE completed_at END WHERE id=? AND state=? RETURNING *`).get(...changes.values, input.to, input.to, input.at, input.jobId, input.expectedFrom) as Row | undefined;
    return row ? { applied: true, job: decode(row)! } : { applied: false, job: this.readJob(input.jobId) };
  }
  async transitionJob(input: TransitionInput) { return this.transition(input); }
  async allocateEventSequence(id: string) {
    const row = this.db.prepare('UPDATE review_jobs SET event_sequence=event_sequence+1 WHERE id=? RETURNING event_sequence').get(id) as { event_sequence: number } | undefined;
    return row?.event_sequence ?? null;
  }
  async getEventSequence(id: string) {
    const row = this.db.prepare('SELECT event_sequence FROM review_jobs WHERE id=?').get(id) as { event_sequence: number } | undefined;
    return row?.event_sequence ?? null;
  }
  async appendRunActivity(record: RunActivityRecord, retain: number): Promise<void> {
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO run_activity (job_id,run_id,seq,at,kind,payload) VALUES (?,?,?,?,?,?)')
        .run(record.jobId, record.runId, record.seq, record.at, record.kind, JSON.stringify(record.payload));
      const result = record.kind === 'provider'
        ? this.db.prepare('UPDATE reviewer_runs SET activity_count=MAX(activity_count,?), last_activity_at=CASE WHEN last_activity_at IS NULL OR last_activity_at < ? THEN ? ELSE last_activity_at END WHERE job_id=? AND id=?')
          .run(record.seq, record.at, record.at, record.jobId, record.runId)
        : this.db.prepare('UPDATE reviewer_runs SET activity_count=MAX(activity_count,?) WHERE job_id=? AND id=?')
          .run(record.seq, record.jobId, record.runId);
      if (result.changes === 0) throw new Error('Unknown run');
      this.db.prepare('DELETE FROM run_activity WHERE run_id=? AND seq <= ?').run(record.runId, record.seq - retain);
    }).immediate();
  }
  async setRunActivityVisibility(jobId: string, runId: string, visibility: ActivityVisibility): Promise<void> {
    this.db.prepare('UPDATE reviewer_runs SET activity_visibility=? WHERE job_id=? AND id=?').run(visibility, jobId, runId);
  }
  private decodeActivity(row: Row): RunActivityRecord {
    return {
      jobId: String(row.job_id), runId: String(row.run_id), seq: Number(row.seq),
      at: String(row.at), kind: row.kind as RunActivityRecord['kind'], payload: JSON.parse(String(row.payload)),
    };
  }
  async listRunActivity(jobId: string, perRunLimit: number): Promise<RunActivityRecord[]> {
    const rows = this.db.prepare(`SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY seq DESC) AS position
      FROM run_activity WHERE job_id=?
    ) WHERE position <= ? ORDER BY run_id,seq ASC`).all(jobId, perRunLimit) as Row[];
    return rows.map(row => this.decodeActivity(row));
  }
  async listRunActivityForRun(jobId: string, runId: string, limit: number): Promise<RunActivityRecord[]> {
    const rows = this.db.prepare(`SELECT * FROM (
      SELECT * FROM run_activity WHERE job_id=? AND run_id=? ORDER BY seq DESC LIMIT ?
    ) ORDER BY seq ASC`).all(jobId, runId, limit) as Row[];
    return rows.map(row => this.decodeActivity(row));
  }
  private putRun(run: ReviewerRunRecord) {
    const existing = this.db.prepare('SELECT job_id,role,selection FROM reviewer_runs WHERE id=?').get(run.id) as Row | undefined;
    if (existing && (existing.job_id !== run.jobId || existing.role !== run.role || existing.selection !== JSON.stringify(run.selection))) throw new Error('Run identity cannot be changed');
    this.db.prepare(`INSERT INTO reviewer_runs (id,job_id,role,selection,state,started_at,completed_at,warning,attempts,sanitized_log,result) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, started_at=excluded.started_at, completed_at=excluded.completed_at, warning=excluded.warning, attempts=excluded.attempts, sanitized_log=excluded.sanitized_log,result=excluded.result`).run(run.id, run.jobId, run.role, JSON.stringify(run.selection), run.state, run.startedAt, run.completedAt, run.warning, run.attempts, run.sanitizedLog, run.result === null ? null : JSON.stringify(run.result));
  }
  async saveRun(run: ReviewerRunRecord) { this.db.transaction(() => this.putRun(run)).immediate(); }
  async listRuns(id: string): Promise<ReviewerRunRecord[]> {
    return (this.db.prepare('SELECT * FROM reviewer_runs WHERE job_id=? ORDER BY rowid').all(id) as Row[]).map(r => ({ id: r.id, jobId: r.job_id, role: r.role, selection: JSON.parse(String(r.selection)), state: r.state, startedAt: r.started_at, completedAt: r.completed_at, warning: r.warning, attempts: r.attempts, sanitizedLog: r.sanitized_log, result: r.result === null ? null : JSON.parse(String(r.result)), activity: { visibility: r.activity_visibility, count: Number(r.activity_count), lastActivityAt: r.last_activity_at } } as ReviewerRunRecord));
  }
  async saveCandidates(records: CandidateFindingRecord[]) {
    this.db.transaction(() => {
      const insert = this.db.prepare('INSERT INTO candidate_findings (job_id,id,run_id,finding) VALUES (?,?,?,?) ON CONFLICT(job_id,id) DO UPDATE SET finding=excluded.finding,run_id=excluded.run_id');
      for (const r of records) insert.run(r.jobId, r.id, r.runId, JSON.stringify(r.finding));
    }).immediate();
  }
  async listCandidates(id: string): Promise<CandidateFindingRecord[]> {
    return (this.db.prepare('SELECT * FROM candidate_findings WHERE job_id=? ORDER BY rowid').all(id) as Row[]).map(r => ({ id: String(r.id), jobId: String(r.job_id), runId: String(r.run_id), finding: JSON.parse(String(r.finding)) }));
  }
  async completeJob(input: CompleteJobInput): Promise<TransitionResult> {
    return this.db.transaction(() => {
      if (input.report.jobId !== input.jobId || input.finalFindings.some(f => f.jobId !== input.jobId)) throw new Error('Completion records belong to a different job');
      const result = this.transition({ jobId: input.jobId, expectedFrom: 'rendering', to: 'completed', at: input.at, ...(input.patch ? { patch: input.patch } : {}) });
      if (!result.applied) return result;
      const report = input.report;
      this.db.prepare('INSERT INTO reports (job_id,report,markdown,duration_ms,created_at) VALUES (?,?,?,?,?)').run(report.jobId, JSON.stringify(report.report), report.markdown, report.durationMs, report.createdAt);
      const insert = this.db.prepare('INSERT INTO final_findings (job_id,id,finding,decision,verification) VALUES (?,?,?,?,?)');
      for (const f of input.finalFindings) insert.run(f.jobId, f.id, JSON.stringify(f.finding), JSON.stringify(f.decision), JSON.stringify(f.verification));
      return result;
    }).immediate();
  }
  async getReport(id: string): Promise<ReportRecord | null> {
    const row = this.db.prepare('SELECT * FROM reports WHERE job_id=?').get(id) as Row | undefined;
    return row ? { jobId: String(row.job_id), report: JSON.parse(String(row.report)), markdown: String(row.markdown), durationMs: Number(row.duration_ms), createdAt: String(row.created_at) } : null;
  }
  async queryJobs(filter: ReviewHistoryFilter, page: HistoryPage) {
    const conditions: string[] = []; const values: unknown[] = [];
    const add = (sql: string, ...args: unknown[]) => { conditions.push(sql); values.push(...args); };
    const pattern = (s: string) => `%${s.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
    const repo = "(json_extract(pull_request,'$.project') || '/' || json_extract(pull_request,'$.repository'))";
    if (filter.repository) add(`lower(${repo}) LIKE ? ESCAPE '\\'`, pattern(filter.repository));
    if (filter.text) add(`lower(json_extract(pull_request,'$.title') || ' ' || ${repo}) LIKE ? ESCAPE '\\'`, pattern(filter.text));
    if (filter.provider) add("(json_extract(main,'$.provider')=? OR EXISTS(SELECT 1 FROM json_each(reviewers) WHERE json_extract(value,'$.provider')=?))", filter.provider, filter.provider);
    if (filter.risk) add('overall_risk=?', filter.risk);
    if (filter.from) add('created_at>=?', filter.from);
    if (filter.to) add('created_at<=?', filter.to);
    if (filter.status === 'active') add(`state NOT IN ${terminal}`);
    else if (filter.status === 'completed' || filter.status === 'completed_with_warnings') add(`state='completed' AND json_array_length(warnings) ${filter.status === 'completed' ? '=' : '>'} 0`);
    else if (filter.status) add('state=?', filter.status);
    if (page.cursor) {
      const [createdAt, id] = Buffer.from(page.cursor, 'base64url').toString().split('|');
      if (!createdAt || !id) throw new Error('Invalid history cursor');
      add('(created_at < ? OR (created_at=? AND id<?))', createdAt, createdAt, id);
    }
    const limit = Math.min(100, Math.max(1, page.limit));
    const rows = this.db.prepare(`SELECT * FROM review_jobs ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...values, limit + 1) as Row[];
    const items = rows.slice(0, limit).map(r => decode(r)!); const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64url') : null };
  }
}
