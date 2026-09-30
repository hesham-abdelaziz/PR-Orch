import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitialPlatform1780000000001 } from './migrations/001-initial-platform.js';
import { SettingsStandards1780000000002 } from './migrations/002-settings-standards.js';
import { ReviewEngine1780000000003 } from './migrations/003-review-engine.js';
import { RunOwnership1780000000004 } from './migrations/004-run-ownership.js';

export function createPlatformDataSource(database: string): DataSource {
  return new DataSource({
    type: 'better-sqlite3', database, synchronize: false, logging: false,
    migrations: [InitialPlatform1780000000001, SettingsStandards1780000000002, ReviewEngine1780000000003, RunOwnership1780000000004],
    prepareDatabase(connection) {
      connection.pragma('journal_mode = WAL');
      connection.pragma('foreign_keys = ON');
      connection.pragma('busy_timeout = 5000');
    },
  });
}
