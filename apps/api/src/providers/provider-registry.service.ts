import {
  isReasoningEffortSupported,
  getSupportedReasoningEfforts,
  type ModelSelection,
  type ProviderId,
  type ProviderStatus,
} from '@pr-orchestrator/contracts';

import type { ProviderAdapter } from './provider-adapter.js';
import { buildModelCatalog } from './model-catalog.service.js';

/** Persistence port for the `provider_snapshots` table supplied by the platform. */
export interface ProviderSnapshotStore {
  load(): Promise<ProviderStatus[] | null>;
  save(statuses: readonly ProviderStatus[]): Promise<void>;
}

export class InMemoryProviderSnapshotStore implements ProviderSnapshotStore {
  private snapshot: ProviderStatus[] | null = null;

  load(): Promise<ProviderStatus[] | null> {
    return Promise.resolve(this.snapshot ? structuredClone(this.snapshot) : null);
  }

  save(statuses: readonly ProviderStatus[]): Promise<void> {
    this.snapshot = structuredClone([...statuses]);

    return Promise.resolve();
  }
}

export class ProviderNotSelectableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotSelectableError';
  }
}

export interface ProviderRegistryOptions {
  adapters: readonly ProviderAdapter[];
  snapshotStore?: ProviderSnapshotStore;
  clock?: () => Date;
  /** Snapshots older than this are refreshed on the next read. */
  staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 10 * 60_000;

export class ProviderRegistryService {
  private readonly adapters: ReadonlyMap<ProviderId, ProviderAdapter>;
  private readonly snapshotStore: ProviderSnapshotStore;
  private readonly clock: () => Date;
  private readonly staleAfterMs: number;
  private snapshot: ProviderStatus[] | null = null;
  private refreshing: Promise<ProviderStatus[]> | null = null;

  constructor(options: ProviderRegistryOptions) {
    this.adapters = new Map(options.adapters.map((adapter) => [adapter.id, adapter]));
    this.snapshotStore = options.snapshotStore ?? new InMemoryProviderSnapshotStore();
    this.clock = options.clock ?? (() => new Date());
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  getAdapter(id: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Provider ${id} is not registered`);

    return adapter;
  }

  async getStatuses(): Promise<ProviderStatus[]> {
    if (this.snapshot && !this.isStale(this.snapshot)) return this.snapshot;

    const persisted = await this.snapshotStore.load();
    if (persisted && persisted.length > 0 && !this.isStale(persisted)) {
      this.snapshot = persisted;

      return persisted;
    }

    return this.refresh();
  }

  refresh(): Promise<ProviderStatus[]> {
    this.refreshing ??= this.probeAll().finally(() => {
      this.refreshing = null;
    });

    return this.refreshing;
  }

  /**
   * Throws unless the provider is usable, the model is listed as available, and
   * any explicit reasoning effort is one the model advertises. Unsupported
   * levels are rejected rather than silently replaced.
   */
  async assertSelectable(selection: ModelSelection): Promise<void> {
    const statuses = await this.getStatuses();
    const status = statuses.find((candidate) => candidate.provider === selection.provider);
    if (!status) {
      throw new ProviderNotSelectableError(`Provider ${selection.provider} is not registered.`);
    }
    if (!status.installed) {
      throw new ProviderNotSelectableError(`${selection.provider} is not installed.`);
    }
    if (
      status.authentication.state !== 'authenticated' &&
      status.authentication.state !== 'unknown_until_run'
    ) {
      const detail = 'message' in status.authentication ? ` ${status.authentication.message ?? ''}` : '';
      throw new ProviderNotSelectableError(
        `${selection.provider} is not ready (${status.authentication.state}).${detail}`.trim(),
      );
    }

    const model = status.modelCatalog.models.find((candidate) => candidate.id === selection.model);
    if (!model) {
      throw new ProviderNotSelectableError(
        `Model "${selection.model}" is not offered by ${selection.provider}.`,
      );
    }
    if (!model.available) {
      throw new ProviderNotSelectableError(
        `Model "${selection.model}" is unavailable: ${model.unavailableReason ?? 'disabled'}.`,
      );
    }
    if (!isReasoningEffortSupported(model, selection.reasoningEffort)) {
      throw new ProviderNotSelectableError(
        `Reasoning effort "${selection.reasoningEffort ?? ''}" is not supported by ${selection.provider} model "${selection.model}". Choose one of: ${getSupportedReasoningEfforts(model).join(', ')}.`,
      );
    }
  }

  private isStale(statuses: readonly ProviderStatus[]): boolean {
    if (statuses.length === 0) return true;

    const oldest = Math.min(...statuses.map((status) => Date.parse(status.refreshedAt)));

    return this.clock().getTime() - oldest >= this.staleAfterMs;
  }

  private async probeAll(): Promise<ProviderStatus[]> {
    const refreshedAt = this.clock().toISOString();
    const statuses = await Promise.all(
      [...this.adapters.values()].map((adapter) => this.probe(adapter, refreshedAt)),
    );

    this.snapshot = statuses;
    await this.snapshotStore.save(statuses);

    return statuses;
  }

  private async probe(adapter: ProviderAdapter, refreshedAt: string): Promise<ProviderStatus> {
    try {
      const installation = await adapter.detectInstallation();
      if (!installation.installed) {
        return {
          provider: adapter.id,
          installed: false,
          authentication: {
            state: 'error',
            message: `The ${adapter.id} CLI is not installed or was not found on PATH.`,
          },
          modelCatalog: { discovery: 'maintained', models: [] },
          refreshedAt,
        };
      }

      const executablePath = installation.displayPath ?? installation.executable?.executablePath;
      const identity = {
        provider: adapter.id,
        installed: true,
        ...(executablePath === undefined ? {} : { executablePath }),
        ...(installation.version === undefined ? {} : { version: installation.version }),
        refreshedAt,
      };

      if (installation.unsupportedReason !== undefined) {
        const catalog = await adapter.listModels();

        return {
          ...identity,
          authentication: { state: 'error', message: installation.unsupportedReason },
          modelCatalog: buildModelCatalog({
            maintained: catalog.models,
            configured: [],
            unavailableReason: installation.unsupportedReason,
          }),
        };
      }

      const [authentication, modelCatalog] = await Promise.all([
        adapter.checkAuthentication(),
        adapter.listModels(),
      ]);

      return { ...identity, authentication, modelCatalog };
    } catch {
      // Adapter errors can carry local paths; keep the public diagnostic generic.
      return {
        provider: adapter.id,
        installed: false,
        authentication: {
          state: 'error',
          message: `Could not inspect the ${adapter.id} CLI. Check that it is installed and runs.`,
        },
        modelCatalog: { discovery: 'maintained', models: [] },
        refreshedAt,
      };
    }
  }
}
