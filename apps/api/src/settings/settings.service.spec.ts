import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataSource } from 'typeorm';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createPlatformDataSource } from '../database/data-source.js';
import { SettingsService } from './settings.service.js';

describe('SettingsService with reasoning effort defaults', () => {
  let directory: string;
  let db: DataSource;
  let service: SettingsService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'settings-store-'));
    db = await createPlatformDataSource(join(directory, 'db.sqlite')).initialize();
    await db.runMigrations();
    service = new SettingsService(db, directory, async () =>
      (['claude', 'codex', 'gemini'] as const).map((provider) => ({
        provider, installed: true, authentication: { state: 'authenticated' as const },
        refreshedAt: new Date().toISOString(),
        modelCatalog: { discovery: 'maintained' as const, models: [{
          id: provider === 'claude' ? 'sonnet' : provider === 'codex' ? 'o3' : 'pro',
          label: 'Fake model', available: true,
          supportedReasoningEfforts: ['low' as const, 'medium' as const, 'high' as const],
        }] },
      })),
    );
  });

  afterEach(async () => {
    if (db.isInitialized) await db.destroy();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists defaultMain and defaultReviewers with reasoningEffort', async () => {
    const updated = await service.update({
      defaultMain: { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' },
      defaultReviewers: [
        { provider: 'codex', model: 'o3', reasoningEffort: 'medium' },
        { provider: 'gemini', model: 'pro', reasoningEffort: 'low' },
      ],
    });

    expect(updated.defaultMain?.reasoningEffort).toBe('high');
    expect(updated.defaultReviewers[0]?.reasoningEffort).toBe('medium');
    expect(updated.defaultReviewers[1]?.reasoningEffort).toBe('low');

    const loaded = await service.get();
    expect(loaded.defaultMain).toEqual({
      provider: 'claude',
      model: 'sonnet',
      reasoningEffort: 'high',
    });
    expect(loaded.defaultReviewers[0]).toEqual({
      provider: 'codex',
      model: 'o3',
      reasoningEffort: 'medium',
    });
  });

  it('preserves backward compatibility when defaultMain has no reasoningEffort', async () => {
    const legacy = await service.update({
      defaultMain: { provider: 'claude', model: 'sonnet' },
      defaultReviewers: [{ provider: 'codex', model: 'cli-default' }],
    });

    expect(legacy.defaultMain?.reasoningEffort).toBeUndefined();
    expect(legacy.defaultReviewers[0]?.reasoningEffort).toBeUndefined();

    const loaded = await service.get();
    expect(loaded.defaultMain?.reasoningEffort).toBeUndefined();
    expect(loaded.defaultReviewers[0]?.reasoningEffort).toBeUndefined();
  });
});
