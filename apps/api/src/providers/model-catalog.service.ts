import * as nativePath from 'node:path';

import type { ModelCatalog, ProviderId, ReasoningEffort } from '@pr-orchestrator/contracts';

import { CLI_DEFAULT_MODEL, NATIVE_REASONING_EFFORTS, isSafeModelId } from './adapters/adapter-command-policy.js';

export interface CatalogModel {
  id: string;
  label: string;
  /** Explicit levels verified for this model; absent means Default only. */
  supportedReasoningEfforts?: readonly ReasoningEffort[];
}

export interface BuildModelCatalogInput {
  /** Aliases the adapter maintains; never claimed to be account-authorized. */
  maintained: readonly CatalogModel[];
  /** Model names read from the user's own CLI configuration. */
  configured: readonly string[];
  /** Models returned by a stable CLI discovery command, when one exists. */
  dynamic?: readonly CatalogModel[];
  /**
   * Effort levels advertised for models read from the user's configuration,
   * when the provider guarantees them for every model it runs.
   */
  configuredReasoningEfforts?: readonly ReasoningEffort[];
  /** Disables every entry, e.g. for an unsupported or missing CLI. */
  unavailableReason?: string;
}

const DEFAULT_MODEL_ENTRY: CatalogModel = {
  id: CLI_DEFAULT_MODEL,
  label: "CLI default (the CLI's own configured model)",
};

export function buildModelCatalog(input: BuildModelCatalogInput): ModelCatalog {
  const base: CatalogModel[] = input.dynamic
    ? [
        input.maintained.find((model) => model.id === CLI_DEFAULT_MODEL) ?? DEFAULT_MODEL_ENTRY,
        ...input.dynamic,
      ]
    : [...input.maintained];

  const known = new Set(base.map((model) => model.id));
  const configuredEntries: CatalogModel[] = [];
  for (const id of input.configured) {
    if (!isSafeModelId(id) || known.has(id)) continue;
    known.add(id);
    configuredEntries.push({
      id,
      label: `${id} (configured locally)`,
      ...(input.configuredReasoningEfforts && input.configuredReasoningEfforts.length > 0
        ? { supportedReasoningEfforts: input.configuredReasoningEfforts }
        : {}),
    });
  }

  const discovery: ModelCatalog['discovery'] = input.dynamic
    ? 'dynamic'
    : configuredEntries.length > 0
      ? 'configured'
      : 'maintained';

  return {
    discovery,
    models: [...base, ...configuredEntries].map((model) => {
      const efforts =
        model.supportedReasoningEfforts && model.supportedReasoningEfforts.length > 0
          ? { supportedReasoningEfforts: [...model.supportedReasoningEfforts] }
          : {};

      return input.unavailableReason === undefined
        ? { id: model.id, label: model.label, available: true, ...efforts }
        : {
            id: model.id,
            label: model.label,
            available: false,
            unavailableReason: input.unavailableReason,
            ...efforts,
          };
    }),
  };
}

export interface ConfigReader {
  readText(path: string): string | undefined;
}

export interface ConfiguredModelsInput {
  homeDirectory: string;
  fileSystem: ConfigReader;
  /** Path API used to build config paths; defaults to the host platform's. */
  pathApi?: Pick<typeof nativePath, 'join'>;
}

/** Reads the default model each CLI is already configured with; never executes anything. */
export function discoverConfiguredModels(
  provider: ProviderId,
  input: ConfiguredModelsInput,
): string[] {
  const models = readConfiguredModel(provider, input);

  return models.filter(isSafeModelId);
}

function readConfiguredModel(
  provider: ProviderId,
  input: ConfiguredModelsInput,
): string[] {
  const { join } = input.pathApi ?? nativePath;
  try {
    switch (provider) {
      case 'codex': {
        const text = input.fileSystem.readText(join(input.homeDirectory, '.codex', 'config.toml'));
        if (text === undefined) return [];
        // Only the top-level table: keys after the first [section] belong to profiles.
        const topLevel = text.split(/^\s*\[/mu)[0] ?? '';
        const match = /^\s*model\s*=\s*"([^"\r\n]+)"/mu.exec(topLevel);

        return match?.[1] ? [match[1]] : [];
      }
      case 'gemini': {
        const text = input.fileSystem.readText(join(input.homeDirectory, '.gemini', 'settings.json'));
        if (text === undefined) return [];
        const parsed = JSON.parse(text) as { model?: string | { name?: string } };
        const model = typeof parsed.model === 'string' ? parsed.model : parsed.model?.name;

        return typeof model === 'string' ? [model] : [];
      }
      case 'claude': {
        const text = input.fileSystem.readText(join(input.homeDirectory, '.claude', 'settings.json'));
        if (text === undefined) return [];
        const parsed = JSON.parse(text) as { model?: unknown };

        return typeof parsed.model === 'string' ? [parsed.model] : [];
      }
    }
  } catch {
    return [];
  }
}

export interface CodexModelCacheInput {
  /** Codex home: CODEX_HOME when set, otherwise `<home>/.codex`. */
  codexHome: string;
  fileSystem: ConfigReader;
  pathApi?: Pick<typeof nativePath, 'join'>;
}

const MAX_CACHED_MODELS = 100;
const MAX_LABEL_LENGTH = 200;

/**
 * Reads the model list Codex caches from its service (`models_cache.json`):
 * the models offered to the signed-in account, with the reasoning levels each
 * supports. The file is an undocumented Codex internal whose shape has changed
 * between versions, so every field is validated and anything unexpected
 * yields `undefined` (callers fall back to the configured-model catalog).
 * Only models Codex itself lists (`visibility: "list"`) are returned, and only
 * effort levels this engine can pass to the Codex CLI are advertised.
 */
export function readCodexModelCache(input: CodexModelCacheInput): CatalogModel[] | undefined {
  const { join } = input.pathApi ?? nativePath;
  let parsed: unknown;
  try {
    const text = input.fileSystem.readText(join(input.codexHome, 'models_cache.json'));
    if (text === undefined) return undefined;
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['models'])) return undefined;

  const supported = NATIVE_REASONING_EFFORTS.codex;
  const models: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const entry of parsed['models']) {
    if (models.length >= MAX_CACHED_MODELS) break;
    if (!isRecord(entry)) continue;
    const slug = entry['slug'];
    if (typeof slug !== 'string' || !isSafeModelId(slug) || slug === CLI_DEFAULT_MODEL || seen.has(slug)) continue;
    if (entry['visibility'] !== 'list') continue;
    seen.add(slug);

    const displayName = typeof entry['display_name'] === 'string' ? entry['display_name'].replace(/\s+/gu, ' ').trim() : '';
    const label = (displayName.length > 0 && displayName !== slug ? `${displayName} (${slug})` : slug).slice(0, MAX_LABEL_LENGTH);
    const levels = Array.isArray(entry['supported_reasoning_levels']) ? entry['supported_reasoning_levels'] : [];
    const efforts: ReasoningEffort[] = [];
    for (const level of levels) {
      const effort = isRecord(level) ? level['effort'] : level;
      if (typeof effort === 'string' && supported.has(effort as ReasoningEffort) && !efforts.includes(effort as ReasoningEffort)) {
        efforts.push(effort as ReasoningEffort);
      }
    }

    models.push({ id: slug, label, ...(efforts.length > 0 ? { supportedReasoningEfforts: efforts } : {}) });
  }

  return models.length > 0 ? models : undefined;
}

/** Codex's home directory, honoring CODEX_HOME like the Codex CLI does. */
export function codexHomeDirectory(
  environment: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
  pathApi: Pick<typeof nativePath, 'join' | 'isAbsolute'> = nativePath,
): string {
  const configured = environment['CODEX_HOME']?.trim();

  return configured && pathApi.isAbsolute(configured) ? configured : pathApi.join(homeDirectory, '.codex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
