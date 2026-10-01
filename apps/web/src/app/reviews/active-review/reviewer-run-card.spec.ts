import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReviewerRunCardComponent, ReviewerRun } from './reviewer-run-card.component';

describe('ReviewerRunCardComponent', () => {
  let fixture: ComponentFixture<ReviewerRunCardComponent>;
  let component: ReviewerRunCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReviewerRunCardComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReviewerRunCardComponent);
    component = fixture.componentInstance;
  });

  // Requirement Test 4: Reviewer card shows run.warning and never contains "[orchestrator:init]" or "Spawning"
  it('shows run.warning and never contains fabricated log lines "[orchestrator:init]" or "Spawning"', () => {
    const runWithWarning: ReviewerRun = {
      id: 'rev-fail-1',
      selection: { provider: 'codex', model: 'gpt-4o' },
      state: 'failed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      warning: 'codex rejected the selected model (exited with code 1)... Details: unsupported flag',
    };

    component.run = runWithWarning;
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;

    // Must show run.warning
    expect(text).toContain('codex rejected the selected model (exited with code 1)');
    expect(text).toContain('Details: unsupported flag');

    // Must NEVER contain fabricated lines
    expect(text).not.toContain('[orchestrator:init]');
    expect(text).not.toContain('[cli:exec]');
    expect(text).not.toContain('Spawning');
    expect(text).not.toContain('[orchestrator:redact]');

    // In log panel
    expect(component.logContent).toBe(runWithWarning.warning);
  });

  // Requirement Test 5: Verifier with attempts 0 and state cancelled renders "Not run"
  it('renders "Not run" for a verifier with attempts 0 and state cancelled', () => {
    const verifierRun: ReviewerRun = {
      id: 'verifier-cancelled-1',
      selection: { provider: 'claude', model: 'claude-3-7-sonnet' },
      role: 'verifier',
      state: 'cancelled',
      attempts: 0,
      startedAt: null,
      completedAt: null,
      warning: 'Not run because the review failed.',
    };

    component.run = verifierRun;
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Not run');

    // Badge indicates Not run
    const notRunBadge = el.querySelector('.badge-not-run');
    expect(notRunBadge).toBeTruthy();
    expect(notRunBadge?.textContent).toContain('Not run');

    // Log panel content is "Not run"
    expect(component.logContent).toBe('Not run');
  });

  it('shows "No process output captured." when there is no warning or log', () => {
    const normalRun: ReviewerRun = {
      id: 'rev-running-1',
      selection: { provider: 'gemini', model: 'gemini-1.5-pro' },
      state: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      warning: null,
    };

    component.run = normalRun;
    fixture.detectChanges();

    expect(component.logContent).toBe('No process output captured.');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('[orchestrator:init]');
    expect(el.textContent).not.toContain('Spawning');
  });

  it('shows real sanitizedLog when present', () => {
    const runWithSanitizedLog: ReviewerRun = {
      id: 'rev-ok-1',
      selection: { provider: 'codex', model: 'gpt-4o' },
      state: 'completed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      warning: null,
      sanitizedLog: 'attempt 1: codex executed successfully in 1200ms',
    };

    component.run = runWithSanitizedLog;
    fixture.detectChanges();

    expect(component.logContent).toBe('attempt 1: codex executed successfully in 1200ms');
  });
});
