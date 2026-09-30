import {
  HttpException,
  Injectable,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  QuotaWindowSchema,
  type ProviderQuota,
  type ProviderQuotasResponse,
  type QuotaReason,
} from '@pr-orchestrator/contracts';
import type { QuotaMeasurement, QuotaSource } from './quota-source.js';

const TTL = 60000;
const COOLDOWN = 15000;
const messages: Record<QuotaReason, string> = {
  unsupported_source:
    'No supported machine-readable quota source is available for this provider.',
  cli_missing: 'The provider CLI was not found.',
  login_required:
    'Existing CLI sign-in is required. Sign in outside this dashboard.',
  unsupported_auth:
    'This authentication mode does not expose subscription quota.',
  source_error: 'Quota could not be read. Retry later.',
  invalid_data: 'The quota source returned unsupported data.',
  no_measurement: 'The source did not report a remaining percentage.',
  refresh_failed: 'Refresh failed. Showing the last successful measurement.',
};
@Injectable()
export class ProviderQuotaService implements OnApplicationShutdown {
  private cached?: ProviderQuotasResponse;
  private inFlight?: Promise<ProviderQuotasResponse>;
  private lastAttempt = -Infinity;
  private cacheExpiresAt = -Infinity;
  private readonly shutdown = new AbortController();
  constructor(
    private readonly sources: readonly QuotaSource[],
    private readonly now: () => number = Date.now,
  ) {}
  async get(refresh = false): Promise<ProviderQuotasResponse> {
    if (this.inFlight) return structuredClone(await this.inFlight);
    const now = this.now();
    if (refresh && now - this.lastAttempt < COOLDOWN)
      throw new HttpException(
        {
          message: 'Wait before refreshing quota again.',
          retryAfterSeconds: Math.ceil(
            (this.lastAttempt + COOLDOWN - now) / 1000,
          ),
        },
        429,
      );
    if (!refresh && this.cached && now < this.cacheExpiresAt)
      return structuredClone(this.cached);
    this.lastAttempt = now;
    this.inFlight = this.refresh().finally(() => {
      this.inFlight = undefined;
    });
    return structuredClone(await this.inFlight);
  }
  private async refresh(): Promise<ProviderQuotasResponse> {
    const providers = await Promise.all(
      (['codex', 'claude', 'gemini'] as const).map(async (provider) => {
        const source = this.sources.find((s) => s.provider === provider);
        let measurement: QuotaMeasurement;
        try {
          measurement = source
            ? await source.read(this.shutdown.signal)
            : {
                status: 'unavailable' as const,
                reason: 'unsupported_source' as const,
                windows: [],
              };
        } catch {
          measurement = {
            status: 'error' as const,
            reason: 'source_error' as const,
            windows: [],
          };
        }
        const checked = this.now();
        const parsed = QuotaWindowSchema.array()
          .max(32)
          .safeParse(measurement.windows);
        if (!parsed.success)
          measurement = {
            status: 'error',
            reason: 'invalid_data',
            windows: [],
          };
        // A successful quota snapshot cannot establish account continuity on a
        // later failed read. Never restore prior-account data after a failure.
        const status = measurement.status;
        const reason = measurement.reason;
        const windows =
          parsed.success && measurement.status !== 'error' ? parsed.data : [];
        const item: ProviderQuota = {
          provider,
          scope: 'account',
          source: provider === 'codex' ? 'codex_app_server' : 'none',
          status,
          reason,
          message: reason ? messages[reason] : null,
          windows,
          lastUpdatedAt:
            status === 'available' ? new Date(checked).toISOString() : null,
          checkedAt: new Date(checked).toISOString(),
          expiresAt: new Date(checked + TTL).toISOString(),
        };
        return item;
      }),
    );
    this.cacheExpiresAt = this.now() + TTL;
    for (const provider of providers)
      provider.expiresAt = new Date(this.cacheExpiresAt).toISOString();
    this.cached = {
      providers,
      cacheTtlSeconds: 60,
      refreshCooldownSeconds: 15,
      nextRefreshAt: new Date(this.lastAttempt + COOLDOWN).toISOString(),
    };
    return this.cached;
  }
  async onApplicationShutdown() {
    this.shutdown.abort();
    await this.inFlight;
    this.cached = undefined;
  }
}
