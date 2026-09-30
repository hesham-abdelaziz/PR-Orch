import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MainModelSelectorComponent, SelectableModelOption } from './main-model-selector.component';
import { ReviewerSelectorComponent } from './reviewer-selector.component';
import { ProviderQuotasStore } from '../../providers/provider-quotas.store';
import { ProviderQuota } from '@pr-orchestrator/contracts';

describe('Model Selection Quota Integration', () => {
  const futureReset1 = new Date(Date.now() + 300 * 60 * 1000).toISOString();
  const futureReset2 = new Date(Date.now() + 10080 * 60 * 1000).toISOString();
  const futureExpires = new Date(Date.now() + 60 * 1000).toISOString();

  const mockCodexQuota: ProviderQuota = {
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

  const mockClaudeQuota: ProviderQuota = {
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

  let providerQuotasStoreMock: {
    getProviderQuota: ReturnType<typeof vi.fn>;
    getProviderSummary: ReturnType<typeof vi.fn>;
    formatDuration: ReturnType<typeof vi.fn>;
    isProviderLocallyStale: ReturnType<typeof vi.fn>;
    isWindowResetPassed: ReturnType<typeof vi.fn>;
  };

  const availableModels: SelectableModelOption[] = [
    { provider: 'codex', model: 'gpt-4o', label: 'GPT-4o', available: true },
    { provider: 'codex', model: 'o3-mini', label: 'o3-mini', available: true },
    { provider: 'claude', model: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', available: true },
  ];

  beforeEach(() => {
    providerQuotasStoreMock = {
      getProviderQuota: vi.fn((provider: string) => {
        if (provider === 'codex') return mockCodexQuota;
        if (provider === 'claude') return mockClaudeQuota;
        return undefined;
      }),
      getProviderSummary: vi.fn((provider: string) => {
        if (provider === 'codex') {
          return 'Codex shared account quota — 5h: 75% remaining; 7d: 81% remaining';
        }
        if (provider === 'claude') {
          return 'Claude quota unavailable (unsupported CLI source)';
        }
        return '';
      }),
      formatDuration: vi.fn((mins: number | null) => (mins === 300 ? '5h' : '7d')),
      isProviderLocallyStale: vi.fn().mockReturnValue(false),
      isWindowResetPassed: vi.fn().mockReturnValue(false),
    };
  });

  describe('MainModelSelectorComponent', () => {
    let fixture: ComponentFixture<MainModelSelectorComponent>;
    let component: MainModelSelectorComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [MainModelSelectorComponent],
        providers: [
          { provide: ProviderQuotasStore, useValue: providerQuotasStoreMock },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(MainModelSelectorComponent);
      component = fixture.componentInstance;
      component.availableModels = availableModels;
    });

    it('displays shared account quota beside dropdown options by joining on provider', () => {
      fixture.detectChanges();
      const options = fixture.nativeElement.querySelectorAll('option');
      expect(options[0].textContent).toContain('GPT-4o (CODEX) — [CODEX shared quota: 5h: 75%; 7d: 81%]');
    });

    it('renders shared account quota label in active verifier model box', () => {
      component.selection = { provider: 'codex', model: 'gpt-4o' };
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.model-quota-row')).toBeTruthy();
      expect(el.textContent).toContain('Codex shared account quota — 5h: 75% remaining; 7d: 81% remaining');
    });

    it('allows model selection even when quota is unavailable (Claude)', () => {
      component.selection = { provider: 'claude', model: 'claude-3-7-sonnet' };
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Claude quota unavailable (unsupported CLI source)');
      const select = el.querySelector('select') as HTMLSelectElement;
      expect(select.disabled).toBe(false);
    });
  });

  describe('ReviewerSelectorComponent', () => {
    let fixture: ComponentFixture<ReviewerSelectorComponent>;
    let component: ReviewerSelectorComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [ReviewerSelectorComponent],
        providers: [
          { provide: ProviderQuotasStore, useValue: providerQuotasStoreMock },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ReviewerSelectorComponent);
      component = fixture.componentInstance;
      component.availableModels = availableModels;
    });

    it('displays shared account quota beside each reviewer showing that reusing Codex shares the same pool', () => {
      component.reviewers = [
        { provider: 'codex', model: 'gpt-4o' },
        { provider: 'codex', model: 'o3-mini' },
      ];
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const quotaLabels = el.querySelectorAll('.reviewer-quota');
      expect(quotaLabels.length).toBe(2);
      expect(quotaLabels[0].textContent).toContain('Codex shared account quota — 5h: 75% remaining; 7d: 81% remaining');
      expect(quotaLabels[1].textContent).toContain('Codex shared account quota — 5h: 75% remaining; 7d: 81% remaining');
    });
  });
});
