import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import {
  ProviderId,
  ProviderQuota,
  ProviderQuotasResponse,
  ProviderQuotasResponseSchema,
  QuotaWindow,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../core/api/api-client.service';
import { ApiError } from '../core/api/api-error';

@Injectable({ providedIn: 'root' })
export class ProviderQuotasStore implements OnDestroy {
  private readonly apiClient = inject(ApiClientService);

  readonly quotasResponse = signal<ProviderQuotasResponse | null>(null);
  readonly loading = signal<boolean>(false);
  readonly refreshing = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly cooldownEndsAt = signal<number | null>(null);
  readonly now = signal<number>(Date.now());

  private timerId: ReturnType<typeof setInterval> | null = null;

  readonly providers = computed<ProviderQuota[]>(() => {
    return this.quotasResponse()?.providers ?? [];
  });

  readonly providersMap = computed<Map<ProviderId, ProviderQuota>>(() => {
    const map = new Map<ProviderId, ProviderQuota>();
    for (const p of this.providers()) {
      map.set(p.provider, p);
    }
    return map;
  });

  readonly nextRefreshAt = computed<string | null>(() => {
    return this.quotasResponse()?.nextRefreshAt ?? null;
  });

  readonly cooldownSecondsRemaining = computed<number>(() => {
    const endsAt = this.cooldownEndsAt();
    if (!endsAt) return 0;
    const remaining = Math.ceil((endsAt - this.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  });

  readonly canRefresh = computed<boolean>(() => {
    if (this.refreshing() || this.loading()) return false;
    return this.cooldownSecondsRemaining() === 0;
  });

  constructor() {
    this.timerId = setInterval(() => {
      this.now.set(Date.now());
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  providerDisplayName(provider: ProviderId | string): string {
    switch (provider) {
      case 'claude':
        return 'Claude';
      case 'codex':
        return 'Codex';
      case 'gemini':
        return 'Gemini';
      default:
        return provider;
    }
  }

  formatDuration(minutes: number | null): string {
    if (minutes === null || minutes <= 0) return '';
    if (minutes < 60) return `${minutes}m`;
    if (minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    const hours = Math.floor(minutes / 60);
    const remMins = minutes % 60;
    return `${hours}h ${remMins}m`;
  }

  formatLocalTime(isoUtc: string | null): string {
    if (!isoUtc) return 'Unavailable';
    try {
      const d = new Date(isoUtc);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoUtc;
    }
  }

  formatResetTime(isoUtc: string | null): string {
    if (!isoUtc) return 'No scheduled reset';
    try {
      const d = new Date(isoUtc);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoUtc;
    }
  }

  isWindowResetPassed(window: QuotaWindow): boolean {
    if (!window.resetAt) return false;
    return new Date(window.resetAt).getTime() <= this.now();
  }

  isProviderLocallyStale(quota: ProviderQuota): boolean {
    if (quota.status === 'stale') return true;
    if (quota.expiresAt && new Date(quota.expiresAt).getTime() <= this.now()) {
      return true;
    }
    return quota.windows.some((w) => this.isWindowResetPassed(w));
  }

  getProviderQuota(provider: ProviderId): ProviderQuota | undefined {
    return this.providersMap().get(provider);
  }

  getProviderSummary(provider: ProviderId): string {
    const quota = this.getProviderQuota(provider);
    if (!quota) return '';

    const name = this.providerDisplayName(provider);

    if (quota.status === 'available') {
      const isStale = this.isProviderLocallyStale(quota);
      const staleNotice = isStale ? ' (stale)' : '';

      if (quota.windows.length === 0) {
        return `${name} shared account quota${staleNotice} — No active quota windows reported`;
      }

      const windowTexts = quota.windows.map((w) => {
        const dur = this.formatDuration(w.windowDurationMins);
        const prefix = dur ? `${dur}: ` : '';
        const resetPassed = this.isWindowResetPassed(w);

        if (resetPassed) {
          return `${prefix}Reset pending`;
        }
        if (w.remainingPercent !== null) {
          return `${prefix}${w.remainingPercent}% remaining`;
        }
        return `${prefix}Unavailable`;
      });

      return `${name} shared account quota${staleNotice} — ${windowTexts.join('; ')}`;
    }

    if (quota.status === 'unauthenticated') {
      return `${name} unauthenticated (run \`${provider} login\` in CLI)`;
    }

    if (quota.status === 'unavailable') {
      return `${name} quota unavailable (unsupported CLI source)`;
    }

    if (quota.status === 'error') {
      return `${name} quota read error`;
    }

    if (quota.status === 'stale') {
      return `${name} quota stale`;
    }

    return '';
  }

  async loadQuotas(): Promise<ProviderQuotasResponse | null> {
    if (this.loading()) return this.quotasResponse();
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.apiClient.request({
        method: 'GET',
        path: '/api/provider-quotas',
        schema: ProviderQuotasResponseSchema,
      });
      this.quotasResponse.set(data);
      if (data.nextRefreshAt) {
        const nextMs = new Date(data.nextRefreshAt).getTime();
        if (nextMs > Date.now()) {
          this.cooldownEndsAt.set(nextMs);
        }
      }
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch provider quotas';
      this.error.set(msg);
      return null;
    } finally {
      this.loading.set(false);
    }
  }

  async refreshQuotas(): Promise<ProviderQuotasResponse | null> {
    if (!this.canRefresh()) {
      return this.quotasResponse();
    }
    this.refreshing.set(true);
    this.error.set(null);
    try {
      const data = await this.apiClient.request({
        method: 'POST',
        path: '/api/provider-quotas/refresh',
        schema: ProviderQuotasResponseSchema,
      });
      this.quotasResponse.set(data);
      if (data.nextRefreshAt) {
        const nextMs = new Date(data.nextRefreshAt).getTime();
        this.cooldownEndsAt.set(nextMs);
      }
      return data;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 429) {
        const retrySec =
          typeof err.data?.['retryAfterSeconds'] === 'number'
            ? err.data['retryAfterSeconds']
            : 15;
        this.cooldownEndsAt.set(Date.now() + retrySec * 1000);
        this.error.set(err.message || `Refresh cooldown active. Try again in ${retrySec}s.`);
      } else {
        const msg = err instanceof Error ? err.message : 'Failed to refresh provider quotas';
        this.error.set(msg);
      }
      return null;
    } finally {
      this.refreshing.set(false);
    }
  }

  clear(): void {
    this.quotasResponse.set(null);
    this.loading.set(false);
    this.refreshing.set(false);
    this.error.set(null);
    this.cooldownEndsAt.set(null);
  }
}
