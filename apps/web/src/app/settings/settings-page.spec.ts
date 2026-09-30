import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsPageComponent } from './settings-page.component';
import { ApiClientService } from '../core/api/api-client.service';
import { ProvidersStore } from '../providers/providers.store';
import { AuthStore } from '../core/auth/auth.store';
import { DEFAULT_SETTINGS, Settings, AzureAuthStatus } from '@pr-orchestrator/contracts';
import { ApiError } from '../core/api/api-error';

describe('SettingsPageComponent', () => {
  let fixture: ComponentFixture<SettingsPageComponent>;
  let component: SettingsPageComponent;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };
  let providersStoreMock: {
    providers: any;
    loading: any;
    error: any;
    load: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    selectableModels: any;
  };
  let authStoreMock: {
    changePassword: ReturnType<typeof vi.fn>;
  };

  const initialSettings: Settings = {
    ...DEFAULT_SETTINGS,
    maxParallelReviewers: 2,
    reviewerTimeoutMs: 300000,
    verifierTimeoutMs: 300000,
    maxStdoutBytes: 1048576,
    maxStderrBytes: 1048576,
    standardsMaxBytes: 1048576,
    workspaceRoot: 'C:\\workspaces',
    excludedGlobs: ['**/package-lock.json'],
    defaultMain: { provider: 'claude', model: 'claude-3-7-sonnet' },
    defaultReviewers: [{ provider: 'codex', model: 'gpt-4o' }],
    defaultAdditionalInstructions: 'Focus on performance',
  };

  const mockAzureStatusPAT: AzureAuthStatus = {
    method: 'pat',
    configured: true,
  };

  const mockAzureStatusCLI: AzureAuthStatus = {
    method: 'azure_cli',
    configured: true,
    executablePath: 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd',
  };

  const mockAzureStatusUnavailable: AzureAuthStatus = {
    method: 'unavailable',
    configured: false,
    reason: 'pat_missing_and_azure_cli_unavailable',
  };

  beforeEach(async () => {
    apiClientMock = {
      request: vi.fn(),
    };
    providersStoreMock = {
      providers: vi.fn().mockReturnValue([
        {
          provider: 'claude',
          installed: true,
          executablePath: 'C:\\bin\\claude.exe',
          version: '1.2.0',
          authentication: { state: 'authenticated' },
          modelCatalog: {
            discovery: 'dynamic',
            models: [{ id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', available: true }],
          },
          refreshedAt: new Date().toISOString(),
        },
        {
          provider: 'codex',
          installed: true,
          executablePath: 'C:\\bin\\codex.cmd',
          version: '0.4.1',
          authentication: { state: 'unknown_until_run', message: 'Checked at execution' },
          modelCatalog: {
            discovery: 'maintained',
            models: [{ id: 'gpt-4o', label: 'GPT-4o', available: true }],
          },
          refreshedAt: new Date().toISOString(),
        },
      ]),
      loading: vi.fn().mockReturnValue(false),
      error: vi.fn().mockReturnValue(null),
      load: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      selectableModels: vi.fn().mockReturnValue([
        { provider: 'claude', model: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
        { provider: 'codex', model: 'gpt-4o', label: 'GPT-4o' },
      ]),
    };
    authStoreMock = {
      changePassword: vi.fn().mockResolvedValue({
        authenticated: true,
        setupRequired: false,
        username: 'admin',
        expiresAt: new Date().toISOString(),
      }),
    };

    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/settings' && opts.method === 'GET') {
        return Promise.resolve(initialSettings);
      }
      if (opts.path === '/api/settings/azure-auth' && opts.method === 'GET') {
        return Promise.resolve(mockAzureStatusPAT);
      }
      return Promise.resolve({});
    });

    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [
        { provide: ApiClientService, useValue: apiClientMock },
        { provide: ProvidersStore, useValue: providersStoreMock },
        { provide: AuthStore, useValue: authStoreMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders settings page with tabs and sections', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Settings');
    expect(el.querySelectorAll('.tab-btn').length).toBeGreaterThanOrEqual(4);
  });

  it('displays PAT configured state without exposing any secret value', async () => {
    const el = fixture.nativeElement as HTMLElement;
    component.activeTab.set('azure');
    fixture.detectChanges();

    expect(el.textContent).toContain('Personal Access Token (PAT)');
    expect(el.textContent).toContain('Configured');
    // Ensure no plaintext secret or dummy PAT is present in inputs
    const patInput = el.querySelector<HTMLInputElement>('input#azure-pat');
    expect(patInput?.value).toBe('');
  });

  it('displays Azure CLI fallback when PAT is unavailable and CLI is configured', async () => {
    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/settings/azure-auth') {
        return Promise.resolve(mockAzureStatusCLI);
      }
      return Promise.resolve(initialSettings);
    });

    await component.loadAzureAuthStatus();
    component.activeTab.set('azure');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Azure CLI (az)');
    expect(el.textContent).toContain('Active Fallback');
  });

  it('tests Azure connection and displays result banner', async () => {
    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/settings/azure-auth/test') {
        return Promise.resolve({ ok: true, message: 'Connected to dev.azure.com successfully' });
      }
      return Promise.resolve({});
    });

    component.activeTab.set('azure');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const testBtn = el.querySelector<HTMLButtonElement>('#test-azure-btn');
    expect(testBtn).toBeTruthy();
    testBtn?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.azure-test-result');
    expect(banner?.textContent).toContain('Connected to dev.azure.com successfully');
  });

  it('displays provider statuses distinguishing dynamic vs maintained catalog and auth states', async () => {
    component.activeTab.set('providers');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Claude');
    expect(el.textContent).toContain('Codex');
    expect(el.textContent).toContain('Dynamic');
    expect(el.textContent).toContain('Maintained');
    expect(el.textContent).toContain('Unknown Until Run');
  });

  it('preserves form and displays error banner when saving review defaults fails', async () => {
    component.activeTab.set('defaults');
    fixture.detectChanges();

    apiClientMock.request.mockRejectedValueOnce(
      new ApiError(400, 'INVALID_SETTINGS', 'Reviewer timeout must be between 30s and 3600s'),
    );

    await component.saveSettings();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error-banner')?.textContent).toContain('Reviewer timeout must be between 30s and 3600s');
    expect(component.settings()?.maxParallelReviewers).toBe(2);
  });
});
