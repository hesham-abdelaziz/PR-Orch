import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { DEFAULT_SETTINGS, type ProviderStatus } from '@pr-orchestrator/contracts';
import { createPlatformDataSource } from '../database/data-source.js';
import { SettingsService } from './settings.service.js';
import { SettingsController } from './settings.controller.js';

const statuses: ProviderStatus[] = [{
  provider: 'claude', installed: true,
  authentication: { state: 'authenticated' },
  refreshedAt: '2026-10-01T00:00:00.000Z',
  modelCatalog: { discovery: 'maintained', models: [
    { id: 'sonnet', label: 'Sonnet', available: true, supportedReasoningEfforts: ['low', 'medium', 'high'] },
    { id: 'haiku', label: 'Haiku', available: true },
  ] },
}];

describe('settings effort request / SQLite / readback regression', () => {
  let root: string;
  let db: DataSource;
  let service: SettingsService;
  let controller: SettingsController;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'settings-effort-'));
    db = await createPlatformDataSource(join(root, 'db.sqlite')).initialize();
    await db.runMigrations();
    service = new SettingsService(db, root, async () => statuses);
    controller = new SettingsController(service, {} as never, {} as never);
  });
  afterEach(async () => {
    await db.destroy();
    await rm(root, { recursive: true, force: true });
  });
  it('saves Claude effort for main and reviewers and reads it after service recreation', async () => {
    const patch = {
      defaultMain: { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' },
      defaultReviewers: [{ provider: 'claude', model: 'sonnet', reasoningEffort: 'low' }],
    };
    await controller.update(patch);
    const reloaded = await new SettingsService(db, root, async () => statuses).get();
    expect(reloaded.defaultMain).toEqual(patch.defaultMain);
    expect(reloaded.defaultReviewers).toEqual(patch.defaultReviewers);
  });
  it.each(['defaultMain', 'defaultReviewers'] as const)('rejects invalid and unsupported effort in %s without overwriting settings', async (field) => {
    const before = await service.get();
    for (const selection of [
      { provider: 'claude', model: 'sonnet', reasoningEffort: 'invalid' },
      { provider: 'claude', model: 'haiku', reasoningEffort: 'high' },
      { provider: 'claude', model: 'sonnet', reasoningEffort: 'max' },
    ]) {
      await expect(controller.update({ [field]: field === 'defaultMain' ? selection : [selection] })).rejects.toThrow();
      expect(await service.get()).toEqual(before);
    }
  });
  it('reads existing settings with omitted effort and saves without provider discovery', async () => {
    const legacy = { ...DEFAULT_SETTINGS, workspaceRoot: join(root, 'workspaces'),
      defaultMain: { provider: 'claude', model: 'old-model' },
      defaultReviewers: [{ provider: 'claude', model: 'old-model' }],
    };
    await db.query('INSERT INTO app_settings (id,settings) VALUES (1,?)', [JSON.stringify(legacy)]);
    service = new SettingsService(db, root, async () => { throw new Error('discovery must not run'); });
    expect(await service.get()).toEqual(legacy);
    await service.update({ maxParallelReviewers: 2 });
    expect((await service.get()).defaultReviewers).toEqual(legacy.defaultReviewers);
    await service.update({ defaultMain: { provider: 'claude', model: 'haiku', reasoningEffort: 'default' } });
    await service.update({ defaultMain: { provider: 'claude', model: 'haiku' } });
    expect((await service.get()).defaultMain?.reasoningEffort).toBeUndefined();
  });
  it('keeps strict unknown-key rejection', async () => {
    await expect(controller.update({ defaultMain: { provider: 'claude', model: 'sonnet', extra: true } })).rejects.toThrow();
  });
});
