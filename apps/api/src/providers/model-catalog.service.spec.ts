import { describe, expect, it } from 'vitest';

import {
  buildModelCatalog,
  discoverConfiguredModels,
} from './model-catalog.service.js';

const maintained = [
  { id: 'cli-default', label: 'CLI default' },
  { id: 'sonnet', label: 'Sonnet' },
] as const;

describe('buildModelCatalog', () => {
  it('marks adapter-maintained lists as maintained and available', () => {
    expect(buildModelCatalog({ maintained, configured: [] })).toEqual({
      discovery: 'maintained',
      models: [
        { id: 'cli-default', label: 'CLI default', available: true },
        { id: 'sonnet', label: 'Sonnet', available: true },
      ],
    });
  });

  it('adds locally configured models, de-duplicates, and drops unsafe identifiers', () => {
    const catalog = buildModelCatalog({
      maintained,
      configured: ['custom-1', 'sonnet', 'custom-1', '--yolo', 'has space', ''],
    });

    expect(catalog.discovery).toBe('configured');
    expect(catalog.models.map((model) => model.id)).toEqual([
      'cli-default',
      'sonnet',
      'custom-1',
    ]);
    expect(catalog.models.find((model) => model.id === 'custom-1')?.label).toContain(
      'configured',
    );
  });

  it('prefers a dynamically discovered list over maintained aliases', () => {
    const catalog = buildModelCatalog({
      maintained,
      configured: [],
      dynamic: [{ id: 'live-model', label: 'Live model' }],
    });

    expect(catalog.discovery).toBe('dynamic');
    expect(catalog.models.map((model) => model.id)).toEqual(['cli-default', 'live-model']);
  });

  it('marks every model unavailable with a reason when the CLI cannot be used', () => {
    const catalog = buildModelCatalog({
      maintained,
      configured: [],
      unavailableReason: 'Unsupported CLI version',
    });

    expect(catalog.models.every((model) => !model.available)).toBe(true);
    expect(catalog.models.every((model) => model.unavailableReason === 'Unsupported CLI version')).toBe(
      true,
    );
  });
});

describe('discoverConfiguredModels', () => {
  const files: Record<string, string> = {
    '/home/u/.codex/config.toml': 'model = "gpt-local"\napproval_policy = "never"\n[profiles.x]\nmodel = "ignored"\n',
    '/home/u/.gemini/settings.json': '{"model":{"name":"gemini-local"}}',
    '/home/u/.claude/settings.json': '{"model":"opus"}',
  };
  const fileSystem = { readText: (path: string) => files[path] };

  it('reads the default model each CLI is configured with', () => {
    expect(discoverConfiguredModels('codex', { homeDirectory: '/home/u', fileSystem })).toEqual([
      'gpt-local',
    ]);
    expect(discoverConfiguredModels('gemini', { homeDirectory: '/home/u', fileSystem })).toEqual([
      'gemini-local',
    ]);
    expect(discoverConfiguredModels('claude', { homeDirectory: '/home/u', fileSystem })).toEqual([
      'opus',
    ]);
  });

  it('ignores missing, malformed, or unsafe configuration', () => {
    expect(
      discoverConfiguredModels('gemini', { homeDirectory: '/nowhere', fileSystem }),
    ).toEqual([]);
    expect(
      discoverConfiguredModels('gemini', {
        homeDirectory: '/home/u',
        fileSystem: { readText: () => '{not json' },
      }),
    ).toEqual([]);
    expect(
      discoverConfiguredModels('codex', {
        homeDirectory: '/home/u',
        fileSystem: { readText: () => 'model = "--yolo"' },
      }),
    ).toEqual([]);
  });
});
