import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import axe from 'axe-core';
import { AppShellComponent } from './layout/app-shell.component';
import { ApiClientService } from './core/api/api-client.service';
import { AuthStore } from './core/auth/auth.store';

describe('Accessibility Standards Audit', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let component: AppShellComponent;

  beforeEach(async () => {
    const authStoreMock = {
      username: vi.fn().mockReturnValue('local-admin'),
      user: vi.fn().mockReturnValue({ username: 'local-admin' }),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    const apiClientMock = {
      request: vi.fn().mockResolvedValue({}),
    };

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: ApiClientService, useValue: apiClientMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppShellComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('contains appropriate landmark regions: header, main, nav, aside', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('header')).toBeTruthy();
    expect(el.querySelector('main')).toBeTruthy();
    expect(el.querySelector('nav')).toBeTruthy();
    expect(el.querySelector('aside')).toBeTruthy();
  });

  it('ensures all interactive buttons have accessible text labels or aria-labels', () => {
    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll('button');
    for (const btn of Array.from(buttons)) {
      const hasText = (btn.textContent?.trim().length ?? 0) > 0;
      const hasAriaLabel = btn.hasAttribute('aria-label');
      const hasTitle = btn.hasAttribute('title');
      expect(hasText || hasAriaLabel || hasTitle).toBe(true);
    }
  });

  it('runs axe-core accessibility audit with zero critical or serious violations', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const results = await axe.run(el, {
      rules: {
        // In jsdom unit tests, color-contrast can't compute real css render trees
        'color-contrast': { enabled: false },
      },
    });

    const criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    if (criticalViolations.length > 0) {
      console.error('Axe violations found:', JSON.stringify(criticalViolations, null, 2));
    }

    expect(criticalViolations.length).toBe(0);
  });
});

describe('Activity Log Expand Control Accessibility', () => {
  let cardFixture: ComponentFixture<any>;

  beforeEach(async () => {
    const { ReviewerRunCardComponent } = await import('./reviews/active-review/reviewer-run-card.component');
    await TestBed.configureTestingModule({
      imports: [ReviewerRunCardComponent],
    }).compileComponents();

    cardFixture = TestBed.createComponent(ReviewerRunCardComponent);
    cardFixture.componentInstance.run = {
      id: 'rev-a11y-1',
      selection: { provider: 'claude', model: 'claude-3-7-sonnet' },
      state: 'running',
      startedAt: '2026-10-01T12:00:00.000Z',
      completedAt: null,
      warning: null,
      activity: {
        visibility: 'full',
        recent: [
          {
            id: 'rev-a11y-1:1',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 1,
            at: '2026-10-01T12:00:10.000Z',
            kind: 'lifecycle',
            action: 'attempt_started',
            attempt: 1,
          },
          {
            id: 'rev-a11y-1:2',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 2,
            at: '2026-10-01T12:00:15.000Z',
            kind: 'provider',
            action: 'reading_file',
            target: { path: 'src/main.ts', startLine: 1, endLine: 30 },
          },
        ],
        current: null,
        lastActivityAt: '2026-10-01T12:00:15.000Z',
        lastHeartbeatAt: null,
        total: 2,
      },
    };
    cardFixture.detectChanges();
  });

  it('ensures the activity log expand control has accessible label and summary semantics', () => {
    const el = cardFixture.nativeElement as HTMLElement;
    const summary = el.querySelector('details.activity-log summary');
    expect(summary).toBeTruthy();

    const ariaLabel = summary?.getAttribute('aria-label');
    const textContent = summary?.textContent?.trim();
    expect(Boolean(ariaLabel || textContent)).toBe(true);
  });

  it('passes axe-core accessibility audit for activity log in both collapsed and expanded states', async () => {
    const el = cardFixture.nativeElement as HTMLElement;

    // 1. Audit collapsed
    let results = await axe.run(el, {
      rules: { 'color-contrast': { enabled: false } },
    });
    let criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(criticalViolations).toHaveLength(0);

    // 2. Expand details and audit
    const details = el.querySelector('details.activity-log') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    cardFixture.detectChanges();

    results = await axe.run(el, {
      rules: { 'color-contrast': { enabled: false } },
    });
    criticalViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(criticalViolations).toHaveLength(0);
  });
});
