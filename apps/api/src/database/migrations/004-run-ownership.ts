import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Forward upgrade: reject existing inconsistent data instead of silently repairing it. */
export class RunOwnership1780000000004 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query('CREATE UNIQUE INDEX ux_reviewer_runs_job_id ON reviewer_runs(job_id,id)');
    await query.query(`CREATE TABLE candidate_findings_owned (job_id TEXT NOT NULL REFERENCES review_jobs(id), id TEXT NOT NULL, run_id TEXT NOT NULL, finding JSON NOT NULL, PRIMARY KEY(job_id,id), FOREIGN KEY(job_id,run_id) REFERENCES reviewer_runs(job_id,id))`);
    await query.query('INSERT INTO candidate_findings_owned SELECT job_id,id,run_id,finding FROM candidate_findings');
    await query.query('DROP TABLE candidate_findings');
    await query.query('ALTER TABLE candidate_findings_owned RENAME TO candidate_findings');
  }
  async down(): Promise<void> { throw new Error('Forward-only migration'); }
}
