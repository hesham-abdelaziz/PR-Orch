import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReviewerSelectorComponent, SelectableModelOption } from './reviewer-selector.component';
import { ModelSelection } from '@pr-orchestrator/contracts';

describe('ReviewerSelectorComponent', () => {
  let component: ReviewerSelectorComponent;
  let fixture: ComponentFixture<ReviewerSelectorComponent>;

  const mockModels: SelectableModelOption[] = [
    {
      provider: 'codex',
      model: 'o3',
      label: 'OpenAI o3',
      available: true,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
    {
      provider: 'codex',
      model: 'cli-default',
      label: 'Codex CLI Default',
      available: true,
    },
    {
      provider: 'claude',
      model: 'sonnet',
      label: 'Claude 3.7 Sonnet',
      available: true,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'max'],
    },
    {
      provider: 'gemini',
      model: 'pro',
      label: 'Gemini 2.5 Pro',
      available: true,
      supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewerSelectorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewerSelectorComponent);
    component = fixture.componentInstance;
    component.availableModels = mockModels;
  });

  it('groups add reviewer dropdown under ChatGPT, Claude, and Gemini in order', () => {
    fixture.detectChanges();
    const selectEl = fixture.nativeElement.querySelector('#add-reviewer-select') as HTMLSelectElement;
    expect(selectEl).toBeTruthy();

    const optgroups = selectEl.querySelectorAll('optgroup');
    expect(optgroups.length).toBe(3);
    expect(optgroups[0].label).toBe('ChatGPT');
    expect(optgroups[1].label).toBe('Claude');
    expect(optgroups[2].label).toBe('Gemini');
  });

  it('provides an independent effort selector for each reviewer row', async () => {
    component.reviewers = [
      { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' },
      { provider: 'codex', model: 'o3', reasoningEffort: 'low' },
      { provider: 'codex', model: 'cli-default', reasoningEffort: 'default' },
    ];
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const effortSelects = fixture.nativeElement.querySelectorAll('.reviewer-effort-select');
    expect(effortSelects.length).toBe(3);

    // Reviewer 0: sonnet (supports low, medium, high, max)
    const select0 = effortSelects[0] as HTMLSelectElement;
    expect(select0.disabled).toBe(false);
    expect(select0.value).toBe('high');

    // Reviewer 1: o3 (supports low, medium, high)
    const select1 = effortSelects[1] as HTMLSelectElement;
    expect(select1.disabled).toBe(false);
    expect(select1.value).toBe('low');

    // Reviewer 2: cli-default (no explicit levels supported)
    const select2 = effortSelects[2] as HTMLSelectElement;
    expect(select2.disabled).toBe(true);
    expect(select2.value).toBe('default');
  });

  it('emits update with modified effort when an individual reviewer effort is changed', () => {
    component.reviewers = [
      { provider: 'claude', model: 'sonnet', reasoningEffort: 'default' },
      { provider: 'codex', model: 'o3', reasoningEffort: 'low' },
    ];
    fixture.detectChanges();

    let updateEvent: { index: number; selection: ModelSelection } | null = null;
    component.update.subscribe((event) => {
      updateEvent = event;
    });

    component.onEffortChange(0, 'medium');

    expect(updateEvent).toEqual({
      index: 0,
      selection: {
        provider: 'claude',
        model: 'sonnet',
        reasoningEffort: 'medium',
      },
    });

    // Reviewer 1 remains unchanged
    expect(component.reviewers[1].reasoningEffort).toBe('low');
  });

  it('enforces uniqueness rule: cannot select the same provider/model twice regardless of effort', () => {
    component.reviewers = [{ provider: 'claude', model: 'sonnet', reasoningEffort: 'low' }];
    fixture.detectChanges();

    // Already added model is disabled in the add dropdown
    expect(component.isModelSelected(mockModels[2])).toBe(true);
    expect(component.isModelDisabled(mockModels[2])).toBe(true);
  });
});
