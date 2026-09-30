import { resolve } from 'node:path';
import type { DataSource } from 'typeorm';
import { DEFAULT_SETTINGS, SettingsSchema, UpdateSettingsRequestSchema, type Settings } from '@pr-orchestrator/contracts';

export class SettingsService {
  constructor(private readonly db: DataSource, private readonly dataRoot: string) {}
  async get(): Promise<Settings> {
    const row = (await this.db.query('SELECT settings FROM app_settings WHERE id=1'))[0];
    return SettingsSchema.parse(row ? JSON.parse(row.settings) : { ...DEFAULT_SETTINGS, workspaceRoot: resolve(this.dataRoot, 'workspaces') });
  }
  async update(input: unknown): Promise<Settings> {
    const patch = UpdateSettingsRequestSchema.parse(input);
    const value = SettingsSchema.parse({ ...await this.get(), ...patch });
    // Workspace cleanup authority belongs to the configured application directory.
    if (resolve(value.workspaceRoot) !== resolve(this.dataRoot, 'workspaces')) throw new Error('Workspace root must remain in application data for this MVP');
    await this.db.query('INSERT INTO app_settings (id,settings) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings', [JSON.stringify(value)]);
    return value;
  }
}
