import type { AuthenticationState, ModelCatalog, ProviderId } from '@pr-orchestrator/contracts';
import { ProviderStatusSchema } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import type {
  ProviderAdapter,
  ProviderInstallation,
} from './provider-adapter.js';
import {
  InMemoryProviderSnapshotStore,
  ProviderNotSelectableError,
  ProviderRegistryService,
} from './provider-registry.service.js';

interface StubState {
  installation: ProviderInstallation;
  authentication: AuthenticationState;
  catalog: ModelCatalog;
  detectCalls: number;
}

function stubAdapter(id: ProviderId, overrides: Partial<StubState> = {}) {
  const state: StubState = {
    installation: {
      installed: true,
      version: '1.0.0',
      executable: { executablePath: `C:\\bin\\${id}.exe`, prefixArgs: [] },
    },
    authentication: { state: 'authenticated' },
    catalog: {
      discovery: 'maintained',
      models: [
        { id: 'cli-default', label: 'CLI default', available: true },
        { id: 'fast', label: 'Fast', available: true },
        { id: 'retired', label: 'Retired', available: false, unavailableReason: 'Retired' },
      ],
    },
    detectCalls: 0,
    ...overrides,
  };
  const adapter: ProviderAdapter = {
    id,
    detectInstallation: () => {
      state.detectCalls += 1;
      return Promise.resolve(state.installation);
    },
    checkAuthentication: () => Promise.resolve(state.authentication),
    listModels: () => Promise.resolve(state.catalog),
    runReview: () => Promise.reject(new Error('not used')),
    cancel: () => Promise.resolve(),
  };

  return { adapter, state };
}

function registryFor(
  stubs: ReturnType<typeof stubAdapter>[],
  options: { now?: () => Date; staleAfterMs?: number; store?: InMemoryProviderSnapshotStore } = {},
) {
  let current = new Date('2026-09-29T10:00:00.000Z');
  const clock = {
    now: options.now ?? (() => current),
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
  const registry = new ProviderRegistryService({
    adapters: stubs.map((stub) => stub.adapter),
    clock: clock.now,
    staleAfterMs: options.staleAfterMs ?? 60_000,
    ...(options.store ? { snapshotStore: options.store } : {}),
  });

  return { registry, clock };
}

describe('ProviderRegistryService', () => {
  it('builds contract-valid statuses for every provider', async () => {
    const stubs = (['claude', 'codex', 'gemini'] as const).map((id) => stubAdapter(id));
    const { registry } = registryFor(stubs);

    const statuses = await registry.refresh();

    expect(statuses.map((status) => status.provider)).toEqual(['claude', 'codex', 'gemini']);
    for (const status of statuses) {
      expect(() => ProviderStatusSchema.parse(status)).not.toThrow();
      expect(status).toMatchObject({
        installed: true,
        version: '1.0.0',
        authentication: { state: 'authenticated' },
        refreshedAt: '2026-09-29T10:00:00.000Z',
      });
    }
    expect(statuses[0]?.executablePath).toBe('C:\\bin\\claude.exe');
  });

  it('shows the CLI entry point rather than node for shim-launched providers', async () => {
    const stub = stubAdapter('codex', {
      installation: {
        installed: true,
        version: '1.0.0',
        executable: { executablePath: 'C:\\node\\node.exe', prefixArgs: ['C:\\npm\\codex.js'] },
        displayPath: 'C:\\npm\\codex.cmd',
      },
    });

    const [status] = await registryFor([stub]).registry.refresh();

    expect(status?.executablePath).toBe('C:\\npm\\codex.cmd');
  });

  it('reports a missing provider as not installed with no selectable models', async () => {
    const stub = stubAdapter('gemini', { installation: { installed: false } });

    const [status] = await registryFor([stub]).registry.refresh();

    expect(status).toMatchObject({
      provider: 'gemini',
      installed: false,
      authentication: { state: 'error', message: expect.stringMatching(/not installed|not found/i) },
      modelCatalog: { models: [] },
    });
    expect(status?.executablePath).toBeUndefined();
  });

  it('reports unauthenticated providers while keeping the catalog visible', async () => {
    const stub = stubAdapter('claude', {
      authentication: { state: 'unauthenticated', message: 'Run claude auth login' },
    });

    const [status] = await registryFor([stub]).registry.refresh();

    expect(status?.authentication).toEqual({
      state: 'unauthenticated',
      message: 'Run claude auth login',
    });
    expect(status?.modelCatalog.models.length).toBeGreaterThan(0);
  });

  it('disables an unsupported CLI version with a diagnostic on every model', async () => {
    const stub = stubAdapter('claude', {
      installation: {
        installed: true,
        version: '2.0.0',
        executable: { executablePath: 'C:\\bin\\claude.exe', prefixArgs: [] },
        unsupportedReason: 'Claude Code 2.1.259 or newer is required',
      },
    });

    const [status] = await registryFor([stub]).registry.refresh();

    expect(status?.authentication).toEqual({
      state: 'error',
      message: 'Claude Code 2.1.259 or newer is required',
    });
    expect(status?.modelCatalog.models.every((model) => !model.available)).toBe(true);
    expect(status?.modelCatalog.models[0]?.unavailableReason).toContain('2.1.259');
  });

  it('isolates an adapter failure to that provider', async () => {
    const good = stubAdapter('claude');
    const bad = stubAdapter('codex');
    bad.adapter.detectInstallation = () => Promise.reject(new Error('boom with C:\\secret\\path'));

    const statuses = await registryFor([good, bad]).registry.refresh();

    expect(statuses[0]?.authentication.state).toBe('authenticated');
    expect(statuses[1]).toMatchObject({
      installed: false,
      authentication: { state: 'error' },
    });
  });

  it('serves the cached snapshot until it goes stale, then refreshes', async () => {
    const stub = stubAdapter('claude');
    const { registry, clock } = registryFor([stub], { staleAfterMs: 60_000 });

    await registry.getStatuses();
    clock.advance(59_000);
    await registry.getStatuses();
    expect(stub.state.detectCalls).toBe(1);

    clock.advance(2_000);
    const refreshed = await registry.getStatuses();
    expect(stub.state.detectCalls).toBe(2);
    expect(refreshed[0]?.refreshedAt).toBe('2026-09-29T10:01:01.000Z');
  });

  it('coalesces concurrent refreshes into one probe per provider', async () => {
    const stub = stubAdapter('claude');
    const { registry } = registryFor([stub]);

    await Promise.all([registry.refresh(), registry.refresh(), registry.getStatuses()]);

    expect(stub.state.detectCalls).toBe(1);
  });

  it('restores a fresh persisted snapshot without probing providers', async () => {
    const store = new InMemoryProviderSnapshotStore();
    const first = registryFor([stubAdapter('claude')], { store });
    await first.registry.refresh();

    const probing = stubAdapter('claude');
    const second = registryFor([probing], { store });
    const statuses = await second.registry.getStatuses();

    expect(probing.state.detectCalls).toBe(0);
    expect(statuses[0]?.provider).toBe('claude');
  });

  describe('assertSelectable', () => {
    it('accepts an available model of an authenticated provider', async () => {
      const { registry } = registryFor([stubAdapter('claude')]);

      await expect(registry.assertSelectable({ provider: 'claude', model: 'fast' })).resolves.toBeUndefined();
    });

    it('accepts providers whose authentication is only confirmed on first run', async () => {
      const { registry } = registryFor([
        stubAdapter('gemini', { authentication: { state: 'unknown_until_run' } }),
      ]);

      await expect(
        registry.assertSelectable({ provider: 'gemini', model: 'fast' }),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['not installed', { installation: { installed: false } }, 'fast'],
      ['unauthenticated', { authentication: { state: 'unauthenticated' } }, 'fast'],
      ['auth error', { authentication: { state: 'error', message: 'x' } }, 'fast'],
      ['unavailable model', {}, 'retired'],
      ['unknown model', {}, 'never-listed'],
    ] as const)('rejects %s', async (_name, overrides, model) => {
      const { registry } = registryFor([stubAdapter('claude', overrides as Partial<StubState>)]);

      await expect(registry.assertSelectable({ provider: 'claude', model })).rejects.toBeInstanceOf(
        ProviderNotSelectableError,
      );
    });

    it('rejects a provider that is not registered', async () => {
      const { registry } = registryFor([stubAdapter('claude')]);

      await expect(
        registry.assertSelectable({ provider: 'codex', model: 'fast' }),
      ).rejects.toBeInstanceOf(ProviderNotSelectableError);
    });
  });

  it('returns adapters by provider id', () => {
    const stub = stubAdapter('codex');
    const { registry } = registryFor([stub]);

    expect(registry.getAdapter('codex')).toBe(stub.adapter);
    expect(() => registry.getAdapter('claude')).toThrow(/not registered/i);
  });

  describe('assertSelectable reasoning effort', () => {
    const withEfforts = () =>
      stubAdapter('claude', {
        catalog: {
          discovery: 'maintained',
          models: [
            { id: 'cli-default', label: 'CLI default', available: true },
            { id: 'opus', label: 'Opus', available: true, supportedReasoningEfforts: ['low', 'medium', 'high'] },
          ],
        },
      });

    it('accepts an advertised level, Default, and an absent effort', async () => {
      const { registry } = registryFor([withEfforts()]);

      for (const reasoningEffort of ['high', 'default', undefined] as const) {
        await expect(
          registry.assertSelectable({ provider: 'claude', model: 'opus', ...(reasoningEffort ? { reasoningEffort } : {}) }),
        ).resolves.toBeUndefined();
      }
    });

    it('rejects a level the model does not advertise, naming the supported ones', async () => {
      const { registry } = registryFor([withEfforts()]);

      const attempt = registry.assertSelectable({ provider: 'claude', model: 'opus', reasoningEffort: 'max' });
      await expect(attempt).rejects.toBeInstanceOf(ProviderNotSelectableError);
      await expect(attempt).rejects.toThrow(/default, low, medium, high/);
    });

    it('rejects any explicit level for a model without capability metadata', async () => {
      const { registry } = registryFor([withEfforts()]);

      await expect(
        registry.assertSelectable({ provider: 'claude', model: 'cli-default', reasoningEffort: 'low' }),
      ).rejects.toBeInstanceOf(ProviderNotSelectableError);
    });
  });
});
