import { Injectable, computed, signal } from '@angular/core';
import { z } from 'zod';
import {
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_ORDER,
  ProviderId,
  ProviderStatus,
  ProviderStatusSchema,
  ReasoningEffort,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../core/api/api-client.service';

export interface SelectableModel {
  provider: ProviderId;
  model: string;
  label: string;
  supportedReasoningEfforts?: ReasoningEffort[];
}

export interface CatalogModelOption {
  provider: ProviderId;
  model: string;
  label: string;
  available: boolean;
  unavailableReason?: string;
  supportedReasoningEfforts?: ReasoningEffort[];
}

export interface ModelGroup<T> {
  provider: ProviderId;
  groupLabel: string;
  models: T[];
}

@Injectable({ providedIn: 'root' })
export class ProvidersStore {
  readonly providers = signal<ProviderStatus[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly selectableModels = computed<SelectableModel[]>(() => {
    const list: SelectableModel[] = [];
    for (const provider of this.providers()) {
      if (!provider.installed) {
        continue;
      }
      for (const model of provider.modelCatalog.models) {
        if (model.available) {
          list.push({
            provider: provider.provider,
            model: model.id,
            label: model.label,
            supportedReasoningEfforts: model.supportedReasoningEfforts,
          });
        }
      }
    }
    return list;
  });

  readonly allInstalledModels = computed<CatalogModelOption[]>(() => {
    const list: CatalogModelOption[] = [];
    for (const provider of this.providers()) {
      if (!provider.installed) {
        continue;
      }
      for (const model of provider.modelCatalog.models) {
        list.push({
          provider: provider.provider,
          model: model.id,
          label: model.label,
          available: model.available,
          unavailableReason: model.unavailableReason,
          supportedReasoningEfforts: model.supportedReasoningEfforts,
        });
      }
    }
    return list;
  });

  /**
   * Grouped models explicitly ordered: ChatGPT (codex), Claude, Gemini.
   */
  readonly groupedSelectableModels = computed<ModelGroup<SelectableModel>[]>(() => {
    const all = this.selectableModels();
    return PROVIDER_ORDER.map((provider) => ({
      provider,
      groupLabel: PROVIDER_DISPLAY_NAMES[provider],
      models: all.filter((m) => m.provider === provider),
    })).filter((group) => group.models.length > 0);
  });

  readonly groupedInstalledModels = computed<ModelGroup<CatalogModelOption>[]>(() => {
    const all = this.allInstalledModels();
    return PROVIDER_ORDER.map((provider) => ({
      provider,
      groupLabel: PROVIDER_DISPLAY_NAMES[provider],
      models: all.filter((m) => m.provider === provider),
    })).filter((group) => group.models.length > 0);
  });

  constructor(private readonly apiClient: ApiClientService) {}

  async load(): Promise<ProviderStatus[]> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.apiClient.request({
        method: 'GET',
        path: '/api/providers',
        schema: z.array(ProviderStatusSchema),
      });
      this.providers.set(data);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch providers';
      this.error.set(msg);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async refresh(): Promise<ProviderStatus[]> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.apiClient.request({
        method: 'POST',
        path: '/api/providers/refresh',
        schema: z.array(ProviderStatusSchema),
      });
      this.providers.set(data);
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to refresh providers';
      this.error.set(msg);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }
}
