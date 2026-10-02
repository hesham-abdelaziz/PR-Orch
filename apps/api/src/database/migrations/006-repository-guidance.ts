import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RepositoryGuidance1780000000006 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query('ALTER TABLE review_jobs ADD COLUMN repository_guidance JSON DEFAULT NULL');
  }
  async down(): Promise<void> { throw new Error('Forward-only migration'); }
}
