import { join, posix, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildModelCatalog,
  codexHomeDirectory,
  discoverConfiguredModels,
  readCodexModelCache,
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
  const CONFIG = {
    codex: 'model = "gpt-local"\napproval_policy = "never"\n[profiles.x]\nmodel = "ignored"\n',
    gemini: '{"model":{"name":"gemini-local"}}',
    claude: '{"model":"opus"}',
  };

  // Builds the fake filesystem with the same path API the code under test uses,
  // so keys match on every OS. Lookups are exact: a wrong separator, home
  // directory or file name finds nothing.
  function configFiles(pathApi: { join(...parts: string[]): string }, home: string) {
    const files = new Map<string, string>([
      [pathApi.join(home, '.codex', 'config.toml'), CONFIG.codex],
      [pathApi.join(home, '.gemini', 'settings.json'), CONFIG.gemini],
      [pathApi.join(home, '.claude', 'settings.json'), CONFIG.claude],
    ]);
    const requested: string[] = [];

    return {
      requested,
      fileSystem: {
        readText: (path: string) => {
          requested.push(path);

          return files.get(path);
        },
      },
    };
  }

  function expectEveryConfiguredModel(input: Parameters<typeof discoverConfiguredModels>[1]) {
    expect(discoverConfiguredModels('codex', input)).toEqual(['gpt-local']);
    expect(discoverConfiguredModels('gemini', input)).toEqual(['gemini-local']);
    expect(discoverConfiguredModels('claude', input)).toEqual(['opus']);
  }

  it('reads the default model each CLI is configured with', () => {
    const home = join('/', 'home', 'u');
    const { fileSystem } = configFiles({ join }, home);

    expectEveryConfiguredModel({ homeDirectory: home, fileSystem });
  });

  it('reads each CLI config from the Windows profile directory', () => {
    const { fileSystem, requested } = configFiles(win32, 'C:\\Users\\Dev');

    expectEveryConfiguredModel({ homeDirectory: 'C:\\Users\\Dev', fileSystem, pathApi: win32 });
    expect(requested).toEqual([
      'C:\\Users\\Dev\\.codex\\config.toml',
      'C:\\Users\\Dev\\.gemini\\settings.json',
      'C:\\Users\\Dev\\.claude\\settings.json',
    ]);
  });

  it('reads each CLI config from a POSIX home directory', () => {
    const { fileSystem, requested } = configFiles(posix, '/home/u');

    expectEveryConfiguredModel({ homeDirectory: '/home/u', fileSystem, pathApi: posix });
    expect(requested).toEqual([
      '/home/u/.codex/config.toml',
      '/home/u/.gemini/settings.json',
      '/home/u/.claude/settings.json',
    ]);
  });

  it('ignores missing, malformed, or unsafe configuration', () => {
    const { fileSystem } = configFiles({ join }, join('/', 'home', 'u'));

    expect(
      discoverConfiguredModels('gemini', { homeDirectory: join('/', 'nowhere'), fileSystem }),
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

  it('carries reasoning effort capabilities, including for unavailable CLIs and configured models', () => {
    const catalog = buildModelCatalog({
      maintained: [
        { id: 'cli-default', label: 'CLI default' },
        { id: 'opus', label: 'Opus', supportedReasoningEfforts: ['low', 'high'] },
      ],
      configured: ['custom-1'],
      configuredReasoningEfforts: ['medium'],
      unavailableReason: 'too old',
    });

    expect(catalog.models).toEqual([
      { id: 'cli-default', label: 'CLI default', available: false, unavailableReason: 'too old' },
      { id: 'opus', label: 'Opus', available: false, unavailableReason: 'too old', supportedReasoningEfforts: ['low', 'high'] },
      {
        id: 'custom-1',
        label: 'custom-1 (configured locally)',
        available: false,
        unavailableReason: 'too old',
        supportedReasoningEfforts: ['medium'],
      },
    ]);
  });
});

describe('readCodexModelCache', () => {
  const home = 'C:\\Users\\me\\.codex';
  const cachePath = win32.join(home, 'models_cache.json');
  const read = (text: string | undefined) =>
    readCodexModelCache({
      codexHome: home,
      pathApi: win32,
      fileSystem: { readText: (path) => (path === cachePath ? text : undefined) },
    });
  // Shape of Codex's models_cache.json (synthetic values).
  const cache = (models: unknown[]) =>
    JSON.stringify({ fetched_at: '2026-09-30T00:00:00Z', client_version: '0.0.0', models });

  it('returns listed models with labels and only the efforts the Codex CLI accepts', () => {
    const models = read(
      cache([
        {
          slug: 'gpt-6.1-sol',
          display_name: 'GPT-6.1-Sol',
          visibility: 'list',
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'xhigh' },
            { effort: 'max' },
            { effort: 'ultra' },
          ],
        },
        { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', supported_reasoning_levels: ['low', 'high'] },
        { slug: 'plain', visibility: 'list' },
      ]),
    );

    expect(models).toEqual([
      { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol (gpt-6.1-sol)', supportedReasoningEfforts: ['low', 'medium', 'xhigh'] },
      { id: 'gpt-5.5', label: 'GPT-5.5 (gpt-5.5)', supportedReasoningEfforts: ['low', 'high'] },
      { id: 'plain', label: 'plain' },
    ]);
  });

  it('skips hidden, duplicate, unsafe and reserved entries', () => {
    const models = read(
      cache([
        { slug: 'gpt-reserve', visibility: 'hide' },
        { slug: 'gpt-a', visibility: 'list' },
        { slug: 'gpt-a', visibility: 'list' },
        { slug: '--dangerously-bypass', visibility: 'list' },
        { slug: 'cli-default', visibility: 'list' },
        { slug: 42, visibility: 'list' },
        'not-an-object',
      ]),
    );

    expect(models?.map((model) => model.id)).toEqual(['gpt-a']);
  });

  it('returns undefined for a missing, malformed, or unrecognized cache', () => {
    expect(read(undefined)).toBeUndefined();
    expect(read('{ not json')).toBeUndefined();
    expect(read(JSON.stringify({ items: [] }))).toBeUndefined();
    expect(read(JSON.stringify([]))).toBeUndefined();
    expect(read(cache([{ slug: 'hidden', visibility: 'hide' }]))).toBeUndefined();
  });

  it('bounds labels and the number of models', () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      slug: `gpt-${index}`,
      display_name: 'x'.repeat(500),
      visibility: 'list',
    }));
    const models = read(cache(many));

    expect(models).toHaveLength(100);
    expect(models?.every((model) => model.label.length <= 200)).toBe(true);
  });
});

describe('codexHomeDirectory', () => {
  it('honors an absolute CODEX_HOME and otherwise uses <home>/.codex', () => {
    expect(codexHomeDirectory({ CODEX_HOME: 'D:\\codex' }, 'C:\\Users\\me', win32)).toBe('D:\\codex');
    expect(codexHomeDirectory({ CODEX_HOME: 'relative' }, 'C:\\Users\\me', win32)).toBe('C:\\Users\\me\\.codex');
    expect(codexHomeDirectory({}, '/home/me', posix)).toBe('/home/me/.codex');
  });
});
