import { TestBed } from '@angular/core/testing';
import { ProvidersStore } from './providers.store';
import { ApiClientService } from '../core/api/api-client.service';
import { ProviderStatus } from '@pr-orchestrator/contracts';

describe('ProvidersStore', () => {
  let store: ProvidersStore;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };

  const mockProviders: ProviderStatus[] = [
    {
      provider: 'claude',
      installed: true,
      executablePath: 'C:\\bin\\claude.exe',
      version: '1.2.0',
      authentication: { state: 'authenticated' },
      modelCatalog: {
        discovery: 'dynamic',
        models: [
          {
            id: 'claude-3-7-sonnet',
            label: 'Claude 3.7 Sonnet',
            available: true,
            supportedReasoningEfforts: ['low', 'medium', 'high'],
          },
          { id: 'claude-3-5-haiku', label: 'Claude 3.5 Haiku', available: false, unavailableReason: 'Rate limit' },
        ],
      },
      refreshedAt: new Date().toISOString(),
    },
    {
      provider: 'codex',
      installed: true,
      executablePath: 'C:\\bin\\codex.cmd',
      version: '0.4.1',
      authentication: { state: 'unknown_until_run', message: 'Auth will be checked at runtime' },
      modelCatalog: {
        discovery: 'maintained',
        models: [
          {
            id: 'gpt-4o',
            label: 'GPT-4o',
            available: true,
            supportedReasoningEfforts: ['low', 'medium', 'high'],
          },
        ],
      },
      refreshedAt: new Date().toISOString(),
    },
    {
      provider: 'gemini',
      installed: false,
      authentication: { state: 'unauthenticated', message: 'Binary not found in PATH' },
      modelCatalog: {
        discovery: 'dynamic',
        models: [],
      },
      refreshedAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    apiClientMock = {
      request: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        ProvidersStore,
        { provide: ApiClientService, useValue: apiClientMock },
      ],
    });

    store = TestBed.inject(ProvidersStore);
  });

  it('fetches providers and populates state', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockProviders);

    await store.load();

    expect(apiClientMock.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/providers',
      schema: expect.anything(),
    });
    expect(store.providers().length).toBe(3);
    expect(store.providers()[0].provider).toBe('claude');
  });

  it('computes selectableModels filtering out unavailable models and preserving reasoning efforts', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockProviders);
    await store.load();

    const selectable = store.selectableModels();
    expect(selectable.length).toBe(2);
    expect(selectable).toEqual([
      {
        provider: 'claude',
        model: 'claude-3-7-sonnet',
        label: 'Claude 3.7 Sonnet',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
      },
      {
        provider: 'codex',
        model: 'gpt-4o',
        label: 'GPT-4o',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
      },
    ]);
  });

  it('groups selectable models explicitly in ChatGPT, Claude, Gemini order', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockProviders);
    await store.load();

    const grouped = store.groupedSelectableModels();
    expect(grouped.length).toBe(2);
    expect(grouped[0].provider).toBe('codex');
    expect(grouped[0].groupLabel).toBe('ChatGPT');
    expect(grouped[0].models[0].model).toBe('gpt-4o');

    expect(grouped[1].provider).toBe('claude');
    expect(grouped[1].groupLabel).toBe('Claude');
    expect(grouped[1].models[0].model).toBe('claude-3-7-sonnet');
  });

  it('refreshes providers when refresh() is invoked', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockProviders);

    await store.refresh();

    expect(apiClientMock.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/providers/refresh',
      schema: expect.anything(),
    });
    expect(store.providers().length).toBe(3);
  });
});
