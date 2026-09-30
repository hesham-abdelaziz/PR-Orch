import { TestBed } from '@angular/core/testing';
import { ProviderQuotasStore } from './provider-quotas.store';
import { ApiClientService } from '../core/api/api-client.service';
import { ApiError } from '../core/api/api-error';
import { ProviderQuotasResponse } from '@pr-orchestrator/contracts';

describe('ProviderQuotasStore', () => {
  let store: ProviderQuotasStore;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };

  const futureReset1 = new Date(Date.now() + 300 * 60 * 1000).toISOString();
  const futureReset2 = new Date(Date.now() + 10080 * 60 * 1000).toISOString();
  const futureExpires = new Date(Date.now() + 60 * 1000).toISOString();
  const futureNextRefresh = new Date(Date.now() + 15 * 1000).toISOString();

  const mockQuotasResponse: ProviderQuotasResponse = {
    providers: [
      {
        provider: 'codex',
        scope: 'account',
        status: 'available',
        reason: null,
        source: 'codex_app_server',
        message: null,
        windows: [
          {
            poolId: 'codex',
            window: 'primary',
            scope: 'shared_pool',
            model: null,
            remainingPercent: 75,
            windowDurationMins: 300,
            resetAt: futureReset1,
          },
          {
            poolId: 'codex',
            window: 'secondary',
            scope: 'shared_pool',
            model: null,
            remainingPercent: 81,
            windowDurationMins: 10080,
            resetAt: futureReset2,
          },
        ],
        lastUpdatedAt: new Date().toISOString(),
        checkedAt: new Date().toISOString(),
        expiresAt: futureExpires,
      },
      {
        provider: 'claude',
        scope: 'account',
        status: 'unavailable',
        reason: 'unsupported_source',
        source: 'none',
        message: 'No machine-readable quota source supported for this CLI version',
        windows: [],
        lastUpdatedAt: null,
        checkedAt: new Date().toISOString(),
        expiresAt: futureExpires,
      },
      {
        provider: 'gemini',
        scope: 'account',
        status: 'unavailable',
        reason: 'unsupported_source',
        source: 'none',
        message: 'No machine-readable quota source supported for this CLI version',
        windows: [],
        lastUpdatedAt: null,
        checkedAt: new Date().toISOString(),
        expiresAt: futureExpires,
      },
    ],
    cacheTtlSeconds: 60,
    refreshCooldownSeconds: 15,
    nextRefreshAt: futureNextRefresh,
  };

  beforeEach(() => {
    apiClientMock = {
      request: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ProviderQuotasStore,
        { provide: ApiClientService, useValue: apiClientMock },
      ],
    });

    store = TestBed.inject(ProviderQuotasStore);
  });

  afterEach(() => {
    store.ngOnDestroy();
  });

  it('fetches provider quotas and populates map', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockQuotasResponse);

    await store.loadQuotas();

    expect(apiClientMock.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/provider-quotas',
      schema: expect.anything(),
    });
    expect(store.providers().length).toBe(3);
    const codex = store.getProviderQuota('codex');
    expect(codex?.status).toBe('available');
    expect(codex?.windows.length).toBe(2);
  });

  it('formats shared account quota summary with actual window durations without averaging or summing', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockQuotasResponse);
    await store.loadQuotas();

    const summary = store.getProviderSummary('codex');
    expect(summary).toContain('Codex shared account quota');
    expect(summary).toContain('5h: 75% remaining');
    expect(summary).toContain('7d: 81% remaining');
  });

  it('distinguishes null remainingPercent as Unavailable and 0% as 0% remaining', async () => {
    const customResponse: ProviderQuotasResponse = {
      ...mockQuotasResponse,
      providers: [
        {
          ...mockQuotasResponse.providers[0],
          windows: [
            {
              poolId: 'codex',
              window: 'primary',
              scope: 'shared_pool',
              model: null,
              remainingPercent: 0,
              windowDurationMins: 60,
              resetAt: futureReset1,
            },
            {
              poolId: 'codex',
              window: 'secondary',
              scope: 'shared_pool',
              model: null,
              remainingPercent: null,
              windowDurationMins: 1440,
              resetAt: futureReset2,
            },
          ],
        },
        mockQuotasResponse.providers[1],
        mockQuotasResponse.providers[2],
      ],
    };

    apiClientMock.request.mockResolvedValueOnce(customResponse);
    await store.loadQuotas();

    const summary = store.getProviderSummary('codex');
    expect(summary).toContain('1h: 0% remaining');
    expect(summary).toContain('1d: Unavailable');
  });

  it('marks data locally stale if expiresAt has passed', async () => {
    const pastExpires = new Date(Date.now() - 5000).toISOString();
    const staleResponse: ProviderQuotasResponse = {
      ...mockQuotasResponse,
      providers: [
        {
          ...mockQuotasResponse.providers[0],
          expiresAt: pastExpires,
        },
        mockQuotasResponse.providers[1],
        mockQuotasResponse.providers[2],
      ],
    };

    apiClientMock.request.mockResolvedValueOnce(staleResponse);
    await store.loadQuotas();

    const codex = store.getProviderQuota('codex')!;
    expect(store.isProviderLocallyStale(codex)).toBe(true);
    expect(store.getProviderSummary('codex')).toContain('(stale)');
  });

  it('marks window as Reset pending if window resetAt has passed', async () => {
    const pastReset = new Date(Date.now() - 10000).toISOString();
    const resetPassedResponse: ProviderQuotasResponse = {
      ...mockQuotasResponse,
      providers: [
        {
          ...mockQuotasResponse.providers[0],
          windows: [
            {
              ...mockQuotasResponse.providers[0].windows[0],
              resetAt: pastReset,
            },
            mockQuotasResponse.providers[0].windows[1],
          ],
        },
        mockQuotasResponse.providers[1],
        mockQuotasResponse.providers[2],
      ],
    };

    apiClientMock.request.mockResolvedValueOnce(resetPassedResponse);
    await store.loadQuotas();

    const summary = store.getProviderSummary('codex');
    expect(summary).toContain('5h: Reset pending');
  });

  it('formats unauthenticated and unsupported statuses correctly', async () => {
    const mixedResponse: ProviderQuotasResponse = {
      ...mockQuotasResponse,
      providers: [
        {
          ...mockQuotasResponse.providers[0],
          status: 'unauthenticated',
          windows: [],
        },
        mockQuotasResponse.providers[1], // unavailable
        mockQuotasResponse.providers[2], // unavailable
      ],
    };

    apiClientMock.request.mockResolvedValueOnce(mixedResponse);
    await store.loadQuotas();

    expect(store.getProviderSummary('codex')).toContain('unauthenticated');
    expect(store.getProviderSummary('claude')).toContain('unavailable');
  });

  it('handles 429 rate limit on explicit refresh and activates cooldown', async () => {
    apiClientMock.request.mockRejectedValueOnce(
      new ApiError(429, 'RATE_LIMITED', 'Rate limited', undefined, { retryAfterSeconds: 12 }),
    );

    await store.refreshQuotas();

    expect(store.cooldownSecondsRemaining()).toBeGreaterThan(0);
    expect(store.canRefresh()).toBe(false);
  });

  it('resets state on clear()', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockQuotasResponse);
    await store.loadQuotas();
    expect(store.providers().length).toBe(3);

    store.clear();
    expect(store.providers().length).toBe(0);
    expect(store.quotasResponse()).toBeNull();
  });
});
