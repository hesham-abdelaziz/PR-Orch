import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlatformDataSource } from './data-source.js';

describe('platform migrations on real SQLite', () => {
  it('upgrades migration 003 without losing candidates and enforces common run ownership', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'orchestrator-upgrade-'));
    const path = join(directory, 'test.sqlite');
    const db = createPlatformDataSource(path);
    db.setOptions({ migrations: db.options.migrations instanceof Array ? db.options.migrations.slice(0, 3) : [] });
    await db.initialize();
    try {
      await db.runMigrations();
      for (const id of ['old', 'other']) await db.query(`INSERT INTO review_jobs (id,state,pull_request,main,reviewers,settings,warnings,exclusions,created_at,updated_at) VALUES (?,'failed','{}','{}','[]','{}','[]','[]','now','now')`, [id]);
      await db.query(`INSERT INTO reviewer_runs (id,job_id,role,selection,state,attempts,sanitized_log) VALUES ('run','old','reviewer','{}','queued',0,'')`);
      await db.query(`INSERT INTO candidate_findings VALUES ('old','finding','run','{}')`);
      await db.destroy();
      const upgraded = await createPlatformDataSource(path).initialize();
      try {
        await upgraded.runMigrations();
        expect(await upgraded.query('SELECT * FROM candidate_findings')).toEqual([{ job_id: 'old', id: 'finding', run_id: 'run', finding: '{}' }]);
        await expect(upgraded.query(`INSERT INTO candidate_findings VALUES ('other','wrong','run','{}')`)).rejects.toThrow();
      } finally { await upgraded.destroy(); }
    } finally { if (db.isInitialized) await db.destroy(); await rm(directory, { recursive: true, force: true }); }
  });
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

describe('run activity migration', () => {
  it('upgrades a 004 database preserving existing rows and defaulting activity columns', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'activity-upgrade-'));
    const path = join(directory, 'test.sqlite');
    const db = createPlatformDataSource(path);
    db.setOptions({ migrations: Array.isArray(db.options.migrations) ? db.options.migrations.slice(0, 4) : [] });
    await db.initialize();
    try {
      await db.runMigrations();
      await db.query("INSERT INTO review_jobs (id,state,pull_request,main,reviewers,settings,warnings,exclusions,created_at,updated_at) VALUES ('old','failed','{}','{}','[]','{}','[]','[]','now','now')");
      await db.query("INSERT INTO reviewer_runs (id,job_id,role,selection,state,attempts,sanitized_log) VALUES ('run','old','reviewer','{}','queued',2,'kept')");
      await db.query("INSERT INTO candidate_findings VALUES ('old','finding','run','{}')");
      const jobs = await db.query('SELECT * FROM review_jobs');
      const runs = await db.query('SELECT * FROM reviewer_runs');
      const candidates = await db.query('SELECT * FROM candidate_findings');
      await db.destroy();
      const upgraded = await createPlatformDataSource(path).initialize();
      try {
        await upgraded.runMigrations();
        expect(await upgraded.query('SELECT * FROM review_jobs')).toEqual(jobs);
        expect(await upgraded.query('SELECT * FROM candidate_findings')).toEqual(candidates);
        expect(await upgraded.query('SELECT * FROM reviewer_runs')).toEqual(runs.map((run: object) => ({ ...run, activity_visibility: null, activity_count: 0, last_activity_at: null })));
        expect(await upgraded.query('SELECT * FROM run_activity')).toEqual([]);
      } finally { await upgraded.destroy(); }
    } finally {
      if (db.isInitialized) await db.destroy();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
