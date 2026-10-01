import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  RunActivityLogComponent,
  formatActivityAction,
  formatActivityTarget,
  formatDuration,
  formatLocalTime,
} from './run-activity-log.component';
import { RunActivity } from '@pr-orchestrator/contracts';

describe('RunActivityLogComponent', () => {
  let fixture: ComponentFixture<RunActivityLogComponent>;
  let component: RunActivityLogComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RunActivityLogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RunActivityLogComponent);
    component = fixture.componentInstance;
  });

  describe('Formatting helpers', () => {
    it('formats duration correctly for sub-minute and multi-minute durations', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(12_000)).toBe('12s');
      expect(formatDuration(59_000)).toBe('59s');
      expect(formatDuration(60_000)).toBe('1m 0s');
      expect(formatDuration(130_000)).toBe('2m 10s');
    });

    it('formats target with range, with single line, and without line numbers', () => {
      expect(formatActivityTarget(undefined)).toBe('');
      expect(formatActivityTarget({ path: 'src/main.ts' })).toBe('src/main.ts');
      expect(formatActivityTarget({ path: 'src/main.ts', startLine: 12 })).toBe('src/main.ts:12');
      expect(formatActivityTarget({ path: 'src/main.ts', startLine: 12, endLine: 12 })).toBe('src/main.ts:12');
      expect(formatActivityTarget({ path: 'src/main.ts', startLine: 10, endLine: 35 })).toBe('src/main.ts:10-35');
    });

    it('formats all 11 action kinds accurately', () => {
      const base: Omit<RunActivity, 'action' | 'kind'> = {
        id: 'run-1:1',
        runId: '123e4567-e89b-12d3-a456-426614174001',
        seq: 1,
        at: '2026-10-01T12:00:00.000Z',
      };

      expect(formatActivityAction({ ...base, kind: 'provider', action: 'reading_file' })).toBe('Reading file');
      expect(formatActivityAction({ ...base, kind: 'provider', action: 'searching' })).toBe('Searching');
      expect(formatActivityAction({ ...base, kind: 'provider', action: 'listing_files' })).toBe('Listing files');
      expect(formatActivityAction({ ...base, kind: 'provider', action: 'running_command' })).toBe('Running a read-only command');
      expect(formatActivityAction({ ...base, kind: 'provider', action: 'thinking' })).toBe('Reasoning');
      expect(formatActivityAction({ ...base, kind: 'provider', action: 'writing_answer' })).toBe('Writing the answer');
      expect(formatActivityAction({ ...base, kind: 'provider', action: 'tool_other' })).toBe('Using a tool');
      expect(formatActivityAction({ ...base, kind: 'provider', action: 'tool_other', tool: 'git_status' })).toBe('Using a tool (git_status)');

      expect(formatActivityAction({ ...base, kind: 'lifecycle', action: 'attempt_started', attempt: 1 })).toBe('Attempt 1 started');
      expect(formatActivityAction({ ...base, kind: 'lifecycle', action: 'attempt_started', attempt: 2 })).toBe('Correction attempt started');
      expect(formatActivityAction({ ...base, kind: 'lifecycle', action: 'process_started' })).toBe('Provider process started');
      expect(formatActivityAction({ ...base, kind: 'lifecycle', action: 'attempt_ended', attempt: 1, outcome: 'completed' })).toBe('Attempt 1 ended: completed');
      expect(formatActivityAction({ ...base, kind: 'lifecycle', action: 'attempt_ended', attempt: 2, outcome: 'failed' })).toBe('Attempt 2 ended: failed');

      expect(formatActivityAction({ ...base, kind: 'notice', action: 'events_skipped', count: 4 })).toBe('4 unreadable progress events ignored');
    });

    it('formats local time as HH:mm:ss', () => {
      const formatted = formatLocalTime('2026-10-01T15:04:05.000Z');
      expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });
  });

  describe('Component rendering & interaction', () => {
    it('displays count hint when total > items.length', () => {
      fixture.componentRef.setInput('total', 50);
      fixture.componentRef.setInput('items', [
        {
          id: 'item-1',
          runId: '123e4567-e89b-12d3-a456-426614174001',
          seq: 1,
          at: '2026-10-01T12:00:00.000Z',
          kind: 'provider',
          action: 'thinking',
        },
      ]);
      fixture.detectChanges();

      const countHint = fixture.nativeElement.querySelector('.log-count-hint');
      expect(countHint).toBeTruthy();
      expect(countHint?.textContent).toContain('Showing the latest 1 of 50 events');
    });

    it('displays "Not run" when isVerifierNotRun is true', () => {
      fixture.componentRef.setInput('isVerifierNotRun', true);
      fixture.componentRef.setInput('items', []);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('Not run');
    });

    it('displays "No activity recorded." when items is empty and not verifierNotRun', () => {
      fixture.componentRef.setInput('isVerifierNotRun', false);
      fixture.componentRef.setInput('items', []);
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('No activity recorded.');
    });

    it('emits expand event on toggle open when hasMore is true', () => {
      const expandSpy = vi.fn();
      component.expand.subscribe(expandSpy);

      fixture.componentRef.setInput('total', 10);
      fixture.componentRef.setInput('items', [
        {
          id: 'item-1',
          runId: '123e4567-e89b-12d3-a456-426614174001',
          seq: 1,
          at: '2026-10-01T12:00:00.000Z',
          kind: 'provider',
          action: 'thinking',
        },
      ]);
      fixture.detectChanges();

      const details = fixture.nativeElement.querySelector('details.activity-log') as HTMLDetailsElement;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      fixture.detectChanges();

      expect(expandSpy).toHaveBeenCalledTimes(1);

      // Second toggle does not emit again
      details.dispatchEvent(new Event('toggle'));
      expect(expandSpy).toHaveBeenCalledTimes(1);
    });

    it('allows fetching again when reopened after a reconnect replaces the log', () => {
      const expandSpy = vi.fn();
      component.expand.subscribe(expandSpy);
      fixture.componentRef.setInput('total', 200);
      fixture.detectChanges();
      const details = fixture.nativeElement.querySelector('details') as HTMLDetailsElement;
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
      expect(expandSpy).toHaveBeenCalledTimes(2);
    });
  });
});
