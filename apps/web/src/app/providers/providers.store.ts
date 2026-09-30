import { Injectable, computed, signal } from '@angular/core';
import { z } from 'zod';
import {
  ProviderId,
  ProviderStatus,
  ProviderStatusSchema,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../core/api/api-client.service';

export interface SelectableModel {
  provider: ProviderId;
  model: string;
  label: string;
}

export interface CatalogModelOption {
  provider: ProviderId;
  model: string;
  label: string;
  available: boolean;
  unavailableReason?: string;
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
        });
      }
    }
    return list;
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
