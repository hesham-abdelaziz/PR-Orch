import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RunActivity1780000000005 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`ALTER TABLE reviewer_runs ADD COLUMN activity_visibility TEXT
      CHECK(activity_visibility IS NULL OR activity_visibility IN ('full','partial','heartbeat_only'))`);
    await query.query('ALTER TABLE reviewer_runs ADD COLUMN activity_count INTEGER NOT NULL DEFAULT 0 CHECK(activity_count >= 0)');
    await query.query('ALTER TABLE reviewer_runs ADD COLUMN last_activity_at TEXT');
    await query.query(`CREATE TABLE run_activity (
      job_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL CHECK(seq > 0),
      at TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('provider','lifecycle','notice')),
      payload JSON NOT NULL CHECK(length(payload) <= 2048),
      PRIMARY KEY(run_id, seq),
      FOREIGN KEY(job_id, run_id) REFERENCES reviewer_runs(job_id, id)
    )`);
    await query.query('CREATE INDEX ix_run_activity_job ON run_activity(job_id, run_id, seq)');
  }
  async down(): Promise<void> { throw new Error('Forward-only migration'); }
}
