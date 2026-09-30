import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProviderStatusCardComponent } from './provider-status-card.component';
import { ProviderQuota, ProviderStatus } from '@pr-orchestrator/contracts';

describe('ProviderStatusCardComponent', () => {
  let fixture: ComponentFixture<ProviderStatusCardComponent>;
  let component: ProviderStatusCardComponent;

  const mockStatus: ProviderStatus = {
    provider: 'codex',
    installed: true,
    executablePath: 'C:\\bin\\codex.cmd',
    version: '0.159.2',
    authentication: { state: 'authenticated' },
    modelCatalog: {
      discovery: 'maintained',
      models: [
        { id: 'gpt-4o', label: 'GPT-4o', available: true },
      ],
    },
    refreshedAt: new Date().toISOString(),
  };

  const futureReset1 = new Date(Date.now() + 300 * 60 * 1000).toISOString();
  const futureReset2 = new Date(Date.now() + 10080 * 60 * 1000).toISOString();
  const futureExpires = new Date(Date.now() + 60 * 1000).toISOString();

  const mockAvailableQuota: ProviderQuota = {
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
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProviderStatusCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProviderStatusCardComponent);
    component = fixture.componentInstance;
    component.status = mockStatus;
  });

  it('renders provider details and empty quota state when quota is not provided', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Codex');
    expect(el.textContent).toContain('Quota not probed');
  });

  it('renders multiple quota windows with derived durations and remaining percentages', () => {
    component.quota = mockAvailableQuota;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Primary (5h)');
    expect(el.textContent).toContain('75% remaining');
    expect(el.textContent).toContain('Secondary (7d)');
    expect(el.textContent).toContain('81% remaining');
    expect(el.textContent).toContain('Fresh');
    expect(el.textContent).toContain('AVAILABLE');
  });

  it('distinguishes depleted 0% from null percentage (Unavailable) without fabricating zero', () => {
    component.quota = {
      ...mockAvailableQuota,
      windows: [
        {
          ...mockAvailableQuota.windows[0],
          remainingPercent: 0,
          windowDurationMins: 60,
        },
        {
          ...mockAvailableQuota.windows[1],
          remainingPercent: null,
          windowDurationMins: 1440,
        },
      ],
    };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('0% remaining');
    expect(el.textContent).toContain('Unavailable');
    expect(el.querySelector('.percent-depleted')).toBeTruthy();
  });

  it('displays stale badge when snapshot has expired or window reset time has passed', () => {
    component.quota = {
      ...mockAvailableQuota,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.badge-stale')).toBeTruthy();
    expect(el.textContent).toContain('Stale');
  });

  it('renders unauthenticated state with terminal command guidance', () => {
    component.quota = {
      provider: 'codex',
      scope: 'account',
      status: 'unauthenticated',
      reason: 'login_required',
      source: 'none',
      message: 'Authentication session expired or not found.',
      windows: [],
      lastUpdatedAt: null,
      checkedAt: new Date().toISOString(),
      expiresAt: futureExpires,
    };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('CLI Authentication Required');
    expect(el.textContent).toContain('codex login');
  });

  it('renders unavailable state explaining unsupported machine-readable source', () => {
    component.status = { ...mockStatus, provider: 'claude' };
    component.quota = {
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
    };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No Machine-Readable Quota Source');
    expect(el.textContent).toContain('Interactive CLI commands');
  });

  it('renders error banner when quota check fails', () => {
    component.quota = {
      provider: 'codex',
      scope: 'account',
      status: 'error',
      reason: 'source_error',
      source: 'none',
      message: 'App server exited with non-zero exit code',
      windows: [],
      lastUpdatedAt: null,
      checkedAt: new Date().toISOString(),
      expiresAt: futureExpires,
    };
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Quota Check Failed');
    expect(el.textContent).toContain('App server exited with non-zero exit code');
  });
});
