import { join } from 'node:path';

import type { ModelCatalog, ProviderId } from '@pr-orchestrator/contracts';

import { CLI_DEFAULT_MODEL, isSafeModelId } from './adapters/adapter-command-policy.js';

export interface CatalogModel {
  id: string;
  label: string;
}

export interface BuildModelCatalogInput {
  /** Aliases the adapter maintains; never claimed to be account-authorized. */
  maintained: readonly CatalogModel[];
  /** Model names read from the user's own CLI configuration. */
  configured: readonly string[];
  /** Models returned by a stable CLI discovery command, when one exists. */
  dynamic?: readonly CatalogModel[];
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
    configuredEntries.push({ id, label: `${id} (configured locally)` });
  }

  const discovery: ModelCatalog['discovery'] = input.dynamic
    ? 'dynamic'
    : configuredEntries.length > 0
      ? 'configured'
      : 'maintained';

  return {
    discovery,
    models: [...base, ...configuredEntries].map((model) =>
      input.unavailableReason === undefined
        ? { id: model.id, label: model.label, available: true }
        : {
            id: model.id,
            label: model.label,
            available: false,
            unavailableReason: input.unavailableReason,
          },
    ),
  };
}

export interface ConfigReader {
  readText(path: string): string | undefined;
}

/** Reads the default model each CLI is already configured with; never executes anything. */
export function discoverConfiguredModels(
  provider: ProviderId,
  input: { homeDirectory: string; fileSystem: ConfigReader },
): string[] {
  const models = readConfiguredModel(provider, input);

  return models.filter(isSafeModelId);
}

function readConfiguredModel(
  provider: ProviderId,
  input: { homeDirectory: string; fileSystem: ConfigReader },
): string[] {
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
