import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
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

    fixture.componentRef.setInput('run', runWithWarning);
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

    fixture.componentRef.setInput('run', verifierRun);
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

    fixture.componentRef.setInput('run', normalRun);
    fixture.detectChanges();

    expect(component.logContent).toBe('No process output captured.');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain('[orchestrator:init]');
    expect(el.textContent).not.toContain('Spawning');
  });

  it('keeps activity and elapsed time for a cancelled verifier that started', () => {
    const runId = '2f5b02de-54d7-4e45-9227-684754f40ee8';
    const activity = {
      id: `${runId}:1`, runId, seq: 1, at: '2026-10-01T12:00:10.000Z',
      kind: 'provider' as const, action: 'reading_file' as const,
      target: { path: 'src/auth.ts' },
    };
    fixture.componentRef.setInput('isVerifier', true);
    fixture.componentRef.setInput('run', {
      id: runId, selection: { provider: 'claude', model: 'sonnet' }, state: 'cancelled',
      startedAt: '2026-10-01T12:00:00.000Z', completedAt: '2026-10-01T12:00:20.000Z',
      warning: 'Review cancelled.',
      activity: { visibility: 'full', recent: [activity], current: activity,
        lastActivityAt: activity.at, lastHeartbeatAt: null, total: 1 },
    });
    fixture.detectChanges();
    expect(component.isVerifierNotRun).toBe(false);
    expect(component.elapsedTimeText).toBe('20s');
    expect(fixture.nativeElement.textContent).toContain('Reading file');
    expect(fixture.nativeElement.querySelector('app-run-activity-log')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.badge-not-run')).toBeNull();
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

    fixture.componentRef.setInput('run', runWithSanitizedLog);
    fixture.detectChanges();

    expect(component.logContent).toBe('attempt 1: codex executed successfully in 1200ms');
  });

  describe('Live Activity Requirements', () => {
    let mockStore: {
      now: WritableSignal<number>;
      loadRunActivity: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      mockStore = {
        now: signal(new Date('2026-10-01T12:01:00.000Z').getTime()),
        loadRunActivity: vi.fn(),
      };

      await TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [ReviewerRunCardComponent],
        providers: [
          {
            provide: (await import('./active-review.store')).ActiveReviewStore,
            useValue: mockStore,
          },
        ],
      }).compileComponents();

      fixture = TestBed.createComponent(ReviewerRunCardComponent);
      component = fixture.componentInstance;
    });

    it('renders each visibility hint correctly', () => {
      // 1. partial
      fixture.componentRef.setInput('run', {
        id: 'run-partial',
        selection: { provider: 'codex', model: 'gpt-4o' },
        state: 'running',
        startedAt: '2026-10-01T12:00:50.000Z',
        completedAt: null,
        warning: null,
        activity: {
          visibility: 'partial',
          recent: [],
          current: null,
          lastActivityAt: '2026-10-01T12:00:55.000Z',
          lastHeartbeatAt: null,
          total: 1,
        },
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Limited visibility: commands only, no file details');

      // 2. heartbeat_only
      fixture.componentRef.setInput('run', {
        ...component.run,
        activity: {
          ...component.run.activity!,
          visibility: 'heartbeat_only',
        },
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Limited visibility: liveness only');

      // 3. null visibility on finished run with total 0
      fixture.componentRef.setInput('run', {
        id: 'run-finished-empty',
        selection: { provider: 'claude', model: 'claude-3-7-sonnet' },
        state: 'completed',
        startedAt: '2026-10-01T12:00:00.000Z',
        completedAt: '2026-10-01T12:00:40.000Z',
        warning: null,
        activity: {
          visibility: null,
          recent: [],
          current: null,
          lastActivityAt: null,
          lastHeartbeatAt: null,
          total: 0,
        },
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('No activity recorded');
    });

    it('formats target with lines (start-end), with start line only, and without lines', () => {
      // With start and end lines
      fixture.componentRef.setInput('run', {
        id: 'run-tgt-1',
        selection: { provider: 'gemini', model: 'gemini-1.5-pro' },
        state: 'running',
        startedAt: '2026-10-01T12:00:00.000Z',
        completedAt: null,
        warning: null,
        activity: {
          visibility: 'full',
          recent: [],
          current: {
            id: 'run-tgt-1:1',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 1,
            at: '2026-10-01T12:00:50.000Z',
            kind: 'provider',
            action: 'reading_file',
            target: { path: 'src/main.ts', startLine: 10, endLine: 25 },
          },
          lastActivityAt: '2026-10-01T12:00:50.000Z',
          lastHeartbeatAt: null,
          total: 1,
        },
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Reading file');
      expect(fixture.nativeElement.textContent).toContain('src/main.ts:10-25');

      // With start line only
      fixture.componentRef.setInput('run', {
        ...component.run,
        activity: {
          ...component.run.activity!,
          current: {
            ...component.run.activity!.current!,
            target: { path: 'src/app.ts', startLine: 42 },
          },
        },
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('src/app.ts:42');

      // Without lines (just path)
      fixture.componentRef.setInput('run', {
        ...component.run,
        activity: {
          ...component.run.activity!,
          current: {
            ...component.run.activity!.current!,
            target: { path: 'src/utils.ts' },
          },
        },
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('src/utils.ts');
      expect(fixture.nativeElement.textContent).not.toContain('src/utils.ts:');
    });

    it('freezes elapsed time after completion and updates while running', () => {
      // Running: now is 12:01:00, startedAt is 12:00:45 -> 15s elapsed
      fixture.componentRef.setInput('run', {
        id: 'run-elapsed',
        selection: { provider: 'gemini', model: 'gemini-1.5-pro' },
        state: 'running',
        startedAt: '2026-10-01T12:00:45.000Z',
        completedAt: null,
        warning: null,
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Elapsed 15s');

      // Clock advances by 10s: now is 12:01:10 -> 25s elapsed
      mockStore.now.set(new Date('2026-10-01T12:01:10.000Z').getTime());
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Elapsed 25s');

      // Completed: startedAt 12:00:45, completedAt 12:01:05 -> frozen at 20s
      fixture.componentRef.setInput('run', {
        ...component.run,
        state: 'completed',
        completedAt: '2026-10-01T12:01:05.000Z',
      });
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Elapsed 20s');

      // Clock advances further to 12:02:00 -> elapsed remains frozen at 20s
      mockStore.now.set(new Date('2026-10-01T12:02:00.000Z').getTime());
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Elapsed 20s');
    });

    it('shows "No activity update for …" only while running and past threshold, never changing state badge', () => {
      // now is 12:01:00. lastActivityAt is 12:00:10 (50s ago > 30s)
      fixture.componentRef.setInput('run', {
        id: 'run-quiet',
        selection: { provider: 'codex', model: 'gpt-4o' },
        state: 'running',
        startedAt: '2026-10-01T12:00:00.000Z',
        completedAt: null,
        warning: null,
        activity: {
          visibility: 'full',
          recent: [],
          current: null,
          lastActivityAt: '2026-10-01T12:00:10.000Z',
          lastHeartbeatAt: null,
          total: 1,
        },
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('No activity update for 50s');

      // Badge must remain RUNNING (never changed to error/warning)
      const badge = el.querySelector('.badge-running');
      expect(badge).toBeTruthy();
      expect(badge?.textContent).toContain('RUNNING');

      // If activity is recent (10s ago)
      fixture.componentRef.setInput('run', {
        ...component.run,
        activity: {
          ...component.run.activity!,
          lastActivityAt: '2026-10-01T12:00:50.000Z',
        },
      });
      fixture.detectChanges();
      expect(el.textContent).toContain('Last activity 10s ago');
      expect(el.textContent).not.toContain('No activity update for');

      // If completed with old activity, do NOT show "No activity update for" warning
      fixture.componentRef.setInput('run', {
        ...component.run,
        state: 'completed',
        completedAt: '2026-10-01T12:01:00.000Z',
        activity: {
          ...component.run.activity!,
          lastActivityAt: '2026-10-01T12:00:10.000Z',
        },
      });
      fixture.detectChanges();
      expect(el.textContent).not.toContain('No activity update for');
    });

    it('displays "No activity recorded" for legacy finished runs', () => {
      const legacyRun: ReviewerRun = {
        id: 'run-legacy',
        selection: { provider: 'claude', model: 'claude-3-7-sonnet' },
        state: 'completed',
        startedAt: '2026-10-01T12:00:00.000Z',
        completedAt: '2026-10-01T12:00:30.000Z',
        warning: null,
      };

      fixture.componentRef.setInput('run', legacyRun);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('No activity recorded');
    });

    it('fetches full activity log once when expanding a log whose total > recent.length', () => {
      fixture.componentRef.setInput('run', {
        id: 'run-expand-test',
        selection: { provider: 'gemini', model: 'gemini-1.5-pro' },
        state: 'running',
        startedAt: '2026-10-01T12:00:00.000Z',
        completedAt: null,
        warning: null,
        activity: {
          visibility: 'full',
          recent: [
            {
              id: 'run-expand-test:1',
              runId: '123e4567-e89b-12d3-a456-426614174001',
              seq: 1,
              at: '2026-10-01T12:00:10.000Z',
              kind: 'provider',
              action: 'thinking',
            },
          ],
          current: null,
          lastActivityAt: '2026-10-01T12:00:10.000Z',
          lastHeartbeatAt: null,
          total: 10, // total > recent.length (10 > 1)
        },
      });
      fixture.detectChanges();

      const detailsEl = fixture.nativeElement.querySelector('details.activity-log') as HTMLDetailsElement;
      expect(detailsEl).toBeTruthy();
      expect(detailsEl.open).toBe(false);

      // Open details
      detailsEl.open = true;
      detailsEl.dispatchEvent(new Event('toggle'));
      fixture.detectChanges();

      expect(mockStore.loadRunActivity).toHaveBeenCalledTimes(1);
      expect(mockStore.loadRunActivity).toHaveBeenCalledWith('run-expand-test');

      // Toggling again does not trigger a second fetch
      detailsEl.dispatchEvent(new Event('toggle'));
      fixture.detectChanges();
      expect(mockStore.loadRunActivity).toHaveBeenCalledTimes(1);
    });

    it('renders heartbeat text while running and hides it when completed', () => {
      fixture.componentRef.setInput('run', {
        id: 'run-hb-test',
        selection: { provider: 'claude', model: 'claude-3-7-sonnet' },
        state: 'running',
        startedAt: '2026-10-01T12:00:00.000Z',
        completedAt: null,
        warning: null,
        activity: {
          visibility: 'full',
          recent: [],
          current: null,
          lastActivityAt: '2026-10-01T12:00:10.000Z',
          lastHeartbeatAt: '2026-10-01T12:00:55.000Z', // 5s ago relative to 12:01:00
          total: 1,
        },
      });
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Process alive · checked 5s ago');

      // When completed, heartbeat is hidden
      fixture.componentRef.setInput('run', {
        ...component.run,
        state: 'completed',
        completedAt: '2026-10-01T12:01:00.000Z',
      });
      fixture.detectChanges();
      expect(el.textContent).not.toContain('Process alive');
    });
  });

});
