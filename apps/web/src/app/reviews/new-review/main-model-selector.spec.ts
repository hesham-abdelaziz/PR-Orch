import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MainModelSelectorComponent, SelectableModelOption } from './main-model-selector.component';
import { ModelSelection } from '@pr-orchestrator/contracts';

describe('MainModelSelectorComponent', () => {
  let component: MainModelSelectorComponent;
  let fixture: ComponentFixture<MainModelSelectorComponent>;

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
      // No supportedReasoningEfforts -> Default only
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
      imports: [MainModelSelectorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(MainModelSelectorComponent);
    component = fixture.componentInstance;
    component.availableModels = mockModels;
  });

  it('groups models explicitly under ChatGPT, Claude, and Gemini in order', () => {
    fixture.detectChanges();
    const groups = component.groupedModels;
    expect(groups.length).toBe(3);
    expect(groups[0].provider).toBe('codex');
    expect(groups[0].groupLabel).toBe('ChatGPT');
    expect(groups[1].provider).toBe('claude');
    expect(groups[1].groupLabel).toBe('Claude');
    expect(groups[2].provider).toBe('gemini');
    expect(groups[2].groupLabel).toBe('Gemini');

    const selectEl = fixture.nativeElement.querySelector('#main-model-select') as HTMLSelectElement;
    const optgroups = selectEl.querySelectorAll('optgroup');
    expect(optgroups.length).toBe(3);
    expect(optgroups[0].label).toBe('ChatGPT');
    expect(optgroups[1].label).toBe('Claude');
    expect(optgroups[2].label).toBe('Gemini');
  });

  it('renders reasoning effort selector with supported levels for selected model', () => {
    component.selection = { provider: 'claude', model: 'sonnet', reasoningEffort: 'default' };
    fixture.detectChanges();

    const effortSelect = fixture.nativeElement.querySelector('#main-effort-select') as HTMLSelectElement;
    expect(effortSelect).toBeTruthy();
    expect(effortSelect.disabled).toBe(false);

    const options = Array.from(effortSelect.querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['default', 'low', 'medium', 'high', 'max']);
  });

  it('disables effort selector and shows explanation when model does not support explicit effort', async () => {
    component.selection = { provider: 'codex', model: 'cli-default', reasoningEffort: 'default' };
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.isEffortDisabled).toBe(true);
    const effortSelect = fixture.nativeElement.querySelector('#main-effort-select') as HTMLSelectElement;
    expect(effortSelect.disabled).toBe(true);

    const hint = fixture.nativeElement.querySelector('#main-effort-hint');
    expect(hint.textContent).toContain('Effort override not supported for this model');
  });

  it('preserves effort when switching to another model that supports the same level', () => {
    let emittedSelection: ModelSelection | null = null;
    component.selectionChange.subscribe((sel) => {
      emittedSelection = sel;
    });

    // Currently o3 with 'high' effort
    component.selection = { provider: 'codex', model: 'o3', reasoningEffort: 'high' };
    fixture.detectChanges();

    // Switch to Claude sonnet (which supports 'high')
    component.onSelectModel('claude:sonnet');
    expect(emittedSelection).toEqual({
      provider: 'claude',
      model: 'sonnet',
      reasoningEffort: 'high',
    });
    expect(component.accessibleAnnouncement).toBe('');
  });

  it('resets effort to default and announces accessibly when new model does not support the level', () => {
    let emittedSelection: ModelSelection | null = null;
    component.selectionChange.subscribe((sel) => {
      emittedSelection = sel;
    });

    // Currently Claude sonnet with 'max' effort
    component.selection = { provider: 'claude', model: 'sonnet', reasoningEffort: 'max' };
    fixture.detectChanges();

    // Switch to o3 (which does NOT support 'max')
    component.onSelectModel('codex:o3');
    expect(emittedSelection).toEqual({
      provider: 'codex',
      model: 'o3',
      reasoningEffort: 'default',
    });
    expect(component.accessibleAnnouncement).toContain('Reasoning effort reset to Default');
  });

  it('emits selection with updated effort when user changes reasoning effort dropdown', () => {
    let emittedSelection: ModelSelection | null = null;
    component.selectionChange.subscribe((sel) => {
      emittedSelection = sel;
    });

    component.selection = { provider: 'codex', model: 'o3', reasoningEffort: 'default' };
    fixture.detectChanges();

    component.onSelectEffort('medium');
    expect(emittedSelection).toEqual({
      provider: 'codex',
      model: 'o3',
      reasoningEffort: 'medium',
    });
  });
});
