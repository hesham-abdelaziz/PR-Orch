import { normalizeCodexQuota, remainingPercent } from './codex-quota.js';
import { ProviderQuotaService } from './quota.service.js';

describe('quota normalization', () => {
  it.each([
    [0, 100],
    [25, 75],
    [100, 0],
    [120, null],
    [-1, null],
    [null, null],
    [undefined, null],
    ['25', null],
    [NaN, null],
    [Infinity, null],
  ])('converts explicit used percent %s to %s', (used, remaining) => {
    expect(remainingPercent(used)).toBe(remaining);
  });
  it('preserves multiple shared pools/windows without duplicating legacy or exposing identities', () => {
    const result = normalizeCodexQuota({
      accountId: 'private@example.com',
      rateLimits: { primary: { usedPercent: 99 } },
      rateLimitsByLimitId: {
        codex: {
          primary: {
            usedPercent: 25,
            windowDurationMins: 300,
            resetsAt: 1800000000,
          },
          secondary: {
            usedPercent: 40,
            windowDurationMins: 10080,
            resetsAt: 1800001000,
          },
        },
        'secret-account-id': { primary: { usedPercent: 50 } },
      },
    });
    expect(result.status).toBe('available');
    expect(result.windows.map((w) => w.remainingPercent)).toEqual([75, 60, 50]);
    expect(
      result.windows.every(
        (w) => w.scope === 'shared_pool' && w.model === null,
      ),
    ).toBe(true);
    expect(result.windows[0]?.resetAt).toBe('2027-01-15T08:00:00.000Z');
    expect(JSON.stringify(result)).not.toMatch(
      /secret-account-id|private@example/,
    );
  });
  it('does not fabricate percentages from unlimited, credits or missing windows', () => {
    expect(
      normalizeCodexQuota({
        rateLimits: { credits: { unlimited: true, balance: '99' } },
      }).status,
    ).toBe('unavailable');
    expect(
      normalizeCodexQuota({ rateLimits: { primary: { usedPercent: null } } })
        .windows[0]?.remainingPercent,
    ).toBeNull();
    expect(
      normalizeCodexQuota({
        rateLimitsByLimitId: {},
        rateLimits: { primary: { usedPercent: 2 } },
      }).windows,
    ).toEqual([]);
  });
});

describe('quota cache', () => {
  const available = () =>
    normalizeCodexQuota({ rateLimits: { primary: { usedPercent: 25 } } });
  it('deduplicates reads/refreshes, uses TTL and throttles explicit refresh', async () => {
    let now = 1800000000000;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new ProviderQuotaService(
      [
        {
          provider: 'codex',
          read: async () => {
            calls++;
            await gate;
            return available();
          },
        },
      ],
      () => now,
    );
    const first = service.get();
    const second = service.get(true);
    release();
    expect(await first).toEqual(await second);
    expect(calls).toBe(1);
    await service.get();
    expect(calls).toBe(1);
    await expect(service.get(true)).rejects.toMatchObject({ status: 429 });
    now += 15000;
    await service.get(true);
    expect(calls).toBe(2);
    now += 60000;
    await service.get();
    expect(calls).toBe(3);
  });
  it('isolates failures and clears prior-account measurements on refresh failure', async () => {
    let now = 1800000000000;
    let fail = false;
    const service = new ProviderQuotaService(
      [
        {
          provider: 'codex',
          read: async () => {
            if (fail) throw new Error('PAT=private-secret');
            return { ...available(), raw: 'private-secret' };
          },
        },
        {
          provider: 'claude',
          read: async () => {
            throw new Error('cookie=secret');
          },
        },
      ],
      () => now,
    );
    const initial = await service.get();
    expect(initial.providers.find((p) => p.provider === 'claude')?.status).toBe(
      'error',
    );
    now += 60000;
    fail = true;
    const response = await service.get();
    const codex = response.providers.find((p) => p.provider === 'codex')!;
    expect(
      initial.providers.find((p) => p.provider === 'codex')?.windows[0]
        ?.remainingPercent,
    ).toBe(75);
    expect(codex.status).toBe('error');
    expect(codex.windows).toEqual([]);
    expect(codex.lastUpdatedAt).toBeNull();
    expect(JSON.stringify(response)).not.toMatch(
      /private-secret|cookie|PAT|raw/,
    );
  });
  it('anchors TTL and advertised expiration at refresh completion', async () => {
    let now = 1800000000000;
    let calls = 0;
    const service = new ProviderQuotaService(
      [
        {
          provider: 'codex',
          read: async () => {
            calls++;
            now += 15000;
            return available();
          },
        },
      ],
      () => now,
    );
    const first = await service.get();
    expect(first.providers.find((p) => p.provider === 'codex')?.expiresAt).toBe(
      '2027-01-15T08:01:15.000Z',
    );
    now += 45000;
    await service.get();
    expect(calls).toBe(1);
    now += 15000;
    await service.get();
    expect(calls).toBe(2);
  });
  it('drops previous quota on unauthenticated or unavailable source and returns detached snapshots', async () => {
    let now = 1800000000000;
    let loggedIn = true;
    const service = new ProviderQuotaService(
      [
        {
          provider: 'codex',
          read: async () =>
            loggedIn
              ? available()
              : {
                  status: 'unauthenticated',
                  reason: 'login_required',
                  windows: [],
                },
        },
      ],
      () => now,
    );
    const response = await service.get();
    response.providers[0]!.windows = [];
    expect(
      (await service.get()).providers.find((p) => p.provider === 'codex')
        ?.windows,
    ).toHaveLength(1);
    loggedIn = false;
    now += 60000;
    const result = (await service.get()).providers.find(
      (p) => p.provider === 'codex',
    )!;
    expect(result.status).toBe('unauthenticated');
    expect(result.windows).toEqual([]);
    expect(result.lastUpdatedAt).toBeNull();
  });
});
