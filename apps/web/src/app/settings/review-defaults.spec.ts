import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReviewDefaultsComponent } from './review-defaults.component';
import { DEFAULT_SETTINGS, Settings } from '@pr-orchestrator/contracts';
import { SelectableModel } from '../providers/providers.store';

describe('ReviewDefaultsComponent', () => {
  let component: ReviewDefaultsComponent;
  let fixture: ComponentFixture<ReviewDefaultsComponent>;

  const mockModels: SelectableModel[] = [
    {
      provider: 'codex',
      model: 'o3',
      label: 'OpenAI o3',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
    {
      provider: 'claude',
      model: 'sonnet',
      label: 'Claude 3.7 Sonnet',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'max'],
    },
    {
      provider: 'gemini',
      model: 'pro',
      label: 'Gemini 2.5 Pro',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
  ];

  const sampleSettings: Settings = {
    ...DEFAULT_SETTINGS,
    excludedGlobs: [...DEFAULT_SETTINGS.excludedGlobs],
    defaultMain: { provider: 'codex', model: 'o3', reasoningEffort: 'high' },
    defaultReviewers: [{ provider: 'claude', model: 'sonnet' }],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewDefaultsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewDefaultsComponent);
    component = fixture.componentInstance;
    component.settings = sampleSettings;
    component.availableModels = mockModels;
  });

  it('groups default main verifier models under ChatGPT, Claude, and Gemini', () => {
    fixture.detectChanges();

    const selectEl = fixture.nativeElement.querySelector('#defaultMain') as HTMLSelectElement;
    expect(selectEl).toBeTruthy();

    const optgroups = selectEl.querySelectorAll('optgroup');
    expect(optgroups.length).toBe(3);
    expect(optgroups[0].label).toBe('ChatGPT');
    expect(optgroups[1].label).toBe('Claude');
    expect(optgroups[2].label).toBe('Gemini');
  });

  it('binds reasoning effort for default main verifier and emits on save', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const effortSelect = fixture.nativeElement.querySelector('#defaultMainEffort') as HTMLSelectElement;
    expect(effortSelect).toBeTruthy();
    expect(effortSelect.value).toBe('high');

    let savedSettings: Settings | null = null;
    component.save.subscribe((s) => {
      savedSettings = s;
    });

    component.onMainEffortChange('medium');
    component.onSave();

    expect((savedSettings as Settings | null)?.defaultMain?.reasoningEffort).toBe('medium');
  });

  it('preserves effort when switching default main model if new model supports it', () => {
    fixture.detectChanges();

    // Currently o3 with 'high'. Claude sonnet supports 'high'.
    component.onMainModelChange('claude:sonnet');
    expect(component.formSettings?.defaultMain).toEqual({
      provider: 'claude',
      model: 'sonnet',
      reasoningEffort: 'high',
    });
  });
});
