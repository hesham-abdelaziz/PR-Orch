import { ProviderStatusSchema, type ProviderStatus } from '@pr-orchestrator/contracts';
import { describe, expect, it, vi } from 'vitest';

import { ProvidersController } from './providers.controller.js';

const status: ProviderStatus = {
  provider: 'claude',
  installed: true,
  version: '2.1.283',
  authentication: { state: 'authenticated' },
  modelCatalog: {
    discovery: 'maintained',
    models: [{ id: 'sonnet', label: 'Sonnet', available: true }],
  },
  refreshedAt: '2026-09-29T10:00:00.000Z',
};

describe('ProvidersController', () => {
  it('serves cached provider statuses that satisfy the shared schema', async () => {
    const registry = {
      getStatuses: vi.fn().mockResolvedValue([status]),
      refresh: vi.fn(),
    };
    const controller = new ProvidersController(registry as never);

    const result = await controller.list();

    expect(result).toEqual([status]);
    expect(() => ProviderStatusSchema.array().parse(result)).not.toThrow();
    expect(registry.refresh).not.toHaveBeenCalled();
  });

  it('forces a refresh on POST /refresh', async () => {
    const registry = {
      getStatuses: vi.fn(),
      refresh: vi.fn().mockResolvedValue([status]),
    };
    const controller = new ProvidersController(registry as never);

    await expect(controller.refresh()).resolves.toEqual([status]);
    expect(registry.refresh).toHaveBeenCalledOnce();
  });
});
