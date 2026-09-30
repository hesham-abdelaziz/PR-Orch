import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatformDataSource } from './data-source.js';

describe('platform migrations on real SQLite', () => {
  it('enforces a single account and active job and persists event sequences after reopening', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orchestrator-db-'));
    const path = join(directory, 'test.sqlite');
    const db = await createPlatformDataSource(path).initialize();
    try {
      await db.runMigrations();
      await db.query("INSERT INTO user_accounts (id, username, password_hash, created_at, updated_at) VALUES (1,'user','hash','now','now')");
      await expect(db.query("INSERT INTO user_accounts (id, username, password_hash, created_at, updated_at) VALUES (2,'other','hash','now','now')")).rejects.toThrow();
      const insert = `INSERT INTO review_jobs (id,state,pull_request,main,reviewers,settings,warnings,exclusions,created_at,updated_at) VALUES (?,'queued','{}','{}','[]','{}','[]','[]','now','now')`;
      await db.query(insert, ['one']);
      await expect(db.query(insert, ['two'])).rejects.toThrow();
      expect(await db.query('UPDATE review_jobs SET event_sequence=event_sequence+1 WHERE id=? RETURNING event_sequence', ['one'])).toEqual([{ event_sequence: 1 }]);
      await db.query("UPDATE review_jobs SET state='completed' WHERE id='one'");
      await db.query(insert, ['two']);
      await db.destroy();
      const reopened = await createPlatformDataSource(path).initialize();
      try {
        expect(await reopened.query('SELECT event_sequence FROM review_jobs WHERE id=?', ['one'])).toEqual([{ event_sequence: 1 }]);
        const columns = await reopened.query('PRAGMA table_info(final_findings)');
        expect(columns).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'verification', notnull: 1 })]));
      } finally { await reopened.destroy(); }
    } finally {
      if (db.isInitialized) await db.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
