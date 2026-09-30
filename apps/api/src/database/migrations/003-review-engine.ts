import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewEngine1780000000003 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`CREATE TABLE review_jobs (
      id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('queued','preparing','reviewing','verifying','rendering','completed','failed','cancelling','cancelled')),
      event_sequence INTEGER NOT NULL DEFAULT 0 CHECK(event_sequence>=0),
      pull_request JSON NOT NULL, main JSON NOT NULL, reviewers JSON NOT NULL,
      additional_instructions TEXT, standards JSON, standards_storage_path TEXT,
      settings JSON NOT NULL, warnings JSON NOT NULL, exclusions JSON NOT NULL,
      failure_reason TEXT, workspace_id TEXT, cleanup_pending INTEGER NOT NULL DEFAULT 0,
      overall_risk TEXT, finding_count INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)`);
    await query.query(`CREATE UNIQUE INDEX ux_review_jobs_single_active ON review_jobs((1)) WHERE state NOT IN ('completed','failed','cancelled')`);
    await query.query(`CREATE INDEX ix_review_jobs_history ON review_jobs(created_at DESC,id DESC)`);
    await query.query(`CREATE TABLE reviewer_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES review_jobs(id), role TEXT NOT NULL, selection JSON NOT NULL, state TEXT NOT NULL, started_at TEXT, completed_at TEXT, warning TEXT, attempts INTEGER NOT NULL, sanitized_log TEXT NOT NULL, result JSON)`);
    await query.query(`CREATE INDEX ix_reviewer_runs_job ON reviewer_runs(job_id)`);
    await query.query(`CREATE TABLE candidate_findings (job_id TEXT NOT NULL REFERENCES review_jobs(id), id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES reviewer_runs(id), finding JSON NOT NULL, PRIMARY KEY(job_id,id))`);
    await query.query(`CREATE TABLE final_findings (job_id TEXT NOT NULL REFERENCES review_jobs(id), id TEXT NOT NULL, finding JSON NOT NULL, decision JSON NOT NULL, verification JSON NOT NULL, PRIMARY KEY(job_id,id))`);
    await query.query(`CREATE TABLE reports (job_id TEXT PRIMARY KEY REFERENCES review_jobs(id), report JSON NOT NULL, markdown TEXT NOT NULL, duration_ms INTEGER NOT NULL, created_at TEXT NOT NULL)`);
  }
  async down(): Promise<void> { throw new Error('Forward-only migration'); }
}
