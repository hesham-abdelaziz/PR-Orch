import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SettingsStandards1780000000002 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK(id=1), settings JSON NOT NULL)`);
    await query.query(`CREATE TABLE standards_versions (id TEXT PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL, storage_path TEXT NOT NULL, uploaded_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0)`);
    await query.query(`CREATE UNIQUE INDEX ux_standards_active ON standards_versions((1)) WHERE active=1`);
    await query.query(`CREATE TABLE provider_snapshots (provider TEXT PRIMARY KEY, snapshot JSON NOT NULL)`);
  }
  async down(): Promise<void> { throw new Error('Forward-only migration'); }
}
