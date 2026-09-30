import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProviderSettingsComponent } from './provider-settings.component';
import { ProvidersStore } from '../providers/providers.store';
import { ProviderQuotasStore } from '../providers/provider-quotas.store';
import { signal } from '@angular/core';

describe('ProviderSettingsComponent', () => {
  let fixture: ComponentFixture<ProviderSettingsComponent>;
  let component: ProviderSettingsComponent;

  let providersStoreMock: {
    providers: any;
    loading: any;
    error: any;
    refresh: ReturnType<typeof vi.fn>;
  };

  let providerQuotasStoreMock: {
    loadQuotas: ReturnType<typeof vi.fn>;
    refreshQuotas: ReturnType<typeof vi.fn>;
    refreshing: any;
    canRefresh: any;
    cooldownSecondsRemaining: any;
    error: any;
    getProviderQuota: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    providersStoreMock = {
      providers: signal([
        {
          provider: 'codex',
          installed: true,
          executablePath: 'C:\\bin\\codex.cmd',
          version: '0.159.2',
          authentication: { state: 'authenticated' },
          modelCatalog: {
            discovery: 'maintained',
            models: [{ id: 'gpt-4o', label: 'GPT-4o', available: true }],
          },
          refreshedAt: new Date().toISOString(),
        },
      ]),
      loading: signal(false),
      error: signal<string | null>(null),
      refresh: vi.fn().mockResolvedValue(undefined),
    };

    providerQuotasStoreMock = {
      loadQuotas: vi.fn().mockResolvedValue(undefined),
      refreshQuotas: vi.fn().mockResolvedValue(undefined),
      refreshing: signal(false),
      canRefresh: signal(true),
      cooldownSecondsRemaining: signal(0),
      error: signal<string | null>(null),
      getProviderQuota: vi.fn().mockReturnValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ProviderSettingsComponent],
      providers: [
        { provide: ProvidersStore, useValue: providersStoreMock },
        { provide: ProviderQuotasStore, useValue: providerQuotasStoreMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProviderSettingsComponent);
    component = fixture.componentInstance;
  });

  it('loads quotas and renders action buttons on init', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(providerQuotasStoreMock.loadQuotas).toHaveBeenCalled();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#refresh-quotas-btn')).toBeTruthy();
    expect(el.textContent).toContain('Refresh Quotas');
  });

  it('triggers refreshQuotas on button click', async () => {
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('#refresh-quotas-btn') as HTMLButtonElement;
    btn.click();

    expect(providerQuotasStoreMock.refreshQuotas).toHaveBeenCalled();
  });

  it('disables refresh button and displays cooldown countdown when cooldown is active', () => {
    providerQuotasStoreMock.canRefresh.set(false);
    providerQuotasStoreMock.cooldownSecondsRemaining.set(12);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('#refresh-quotas-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Cooldown (12s)');
  });

  it('displays refreshing state while refresh is in flight', () => {
    providerQuotasStoreMock.canRefresh.set(false);
    providerQuotasStoreMock.refreshing.set(true);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('#refresh-quotas-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('Refreshing Quotas...');
  });

  it('displays quota error banner if quota operation fails', () => {
    providerQuotasStoreMock.error.set('429 Rate limited. Please try again later.');
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.quota-error-banner')).toBeTruthy();
    expect(el.textContent).toContain('429 Rate limited');
  });
});
