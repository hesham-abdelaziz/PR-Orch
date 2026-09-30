import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialPlatform1780000000001 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`CREATE TABLE user_accounts (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await query.query(`CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user_accounts(id), expires_at TEXT NOT NULL, revoked_at TEXT)`);
    await query.query(`CREATE INDEX ix_sessions_expiry ON sessions(expires_at)`);
    await query.query(`CREATE TABLE credential_references (credential_key TEXT PRIMARY KEY, target TEXT NOT NULL)`);
  }
  async down(): Promise<void> { throw new Error('Forward-only migration'); }
}
