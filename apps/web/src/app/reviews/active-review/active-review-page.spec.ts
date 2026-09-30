import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ActiveReviewPageComponent } from './active-review-page.component';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReviewEventsService } from '../../core/api/review-events.service';
import { ReviewJob } from '@pr-orchestrator/contracts';
import { Subject } from 'rxjs';

describe('ActiveReviewPageComponent', () => {
  let fixture: ComponentFixture<ActiveReviewPageComponent>;
  let component: ActiveReviewPageComponent;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };
  let eventsSubject: Subject<any>;
  let eventsServiceMock: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };

  const mockActiveJob: ReviewJob = {
    id: '123e4567-e89b-12d3-a456-426614174099',
    state: 'reviewing',
    pullRequest: {
      url: 'https://dev.azure.com/acme/project/_git/auth-service/pullrequest/4819',
      organization: 'acme-corp',
      project: 'CorePlatform',
      repository: 'auth-service',
      pullRequestId: 4819,
      title: 'Refactor OAuth2 token exchange & introduce JWKS cache',
      author: { id: 'elena', displayName: 'Elena Rostova' },
      sourceBranch: 'feature/jwt-rotation-v2',
      targetBranch: 'main',
      sourceCommit: 'c89fa31abcdef0123456789abcdef0123456789',
      targetCommit: '1234567abcdef0123456789abcdef0123456789',
      changedFiles: 14,
      additions: 482,
      deletions: 119,
      updatedAt: '2026-09-30T10:00:00.000Z',
    },
    main: { provider: 'claude', model: 'claude-3-7-sonnet' },
    reviewers: [
      {
        id: 'rev-1',
        selection: { provider: 'codex', model: 'gpt-4o' },
        state: 'running',
        startedAt: new Date().toISOString(),
        completedAt: null,
        warning: null,
      },
      {
        id: 'rev-2',
        selection: { provider: 'gemini', model: 'gemini-1.5-pro' },
        state: 'running',
        startedAt: new Date().toISOString(),
        completedAt: null,
        warning: null,
      },
    ],
    standards: null,
    warnings: ['Detected framework guidance used as fallback standards.'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  beforeEach(async () => {
    eventsSubject = new Subject();
    apiClientMock = {
      request: vi.fn(),
    };
    eventsServiceMock = {
      connect: vi.fn().mockReturnValue(eventsSubject.asObservable()),
      disconnect: vi.fn(),
    };

    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/reviews/active') {
        return Promise.resolve(mockActiveJob);
      }
      if (opts.path.endsWith('/cancel')) {
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({});
    });

    await TestBed.configureTestingModule({
      imports: [ActiveReviewPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: apiClientMock },
        { provide: ReviewEventsService, useValue: eventsServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ActiveReviewPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.store.loadJob();
    fixture.detectChanges();
  });

  afterEach(() => {
    component.store.disconnect();
  });

  it('renders active review header with PR metadata and single Cancel Review action', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('PR #4819');
    expect(el.textContent).toContain('Refactor OAuth2 token exchange');

    const cancelBtn = el.querySelector<HTMLButtonElement>('#cancel-review-btn');
    expect(cancelBtn).toBeTruthy();
    expect(cancelBtn?.textContent).toContain('Cancel Review');
  });

  it('renders all eight deterministic pipeline stages', () => {
    const el = fixture.nativeElement as HTMLElement;
    const stages = el.querySelectorAll('.stage-item');
    expect(stages.length).toBe(8);

    const stageNames = Array.from(stages).map((s) => s.textContent);
    expect(stageNames.some((t) => t?.includes('VALIDATE'))).toBe(true);
    expect(stageNames.some((t) => t?.includes('CHECKOUT'))).toBe(true);
    expect(stageNames.some((t) => t?.includes('DETECT'))).toBe(true);
    expect(stageNames.some((t) => t?.includes('STANDARDS'))).toBe(true);
    expect(stageNames.some((t) => t?.includes('REVIEWERS'))).toBe(true);
    expect(stageNames.some((t) => t?.includes('VERIFY'))).toBe(true);
    expect(stageNames.some((t) => t?.includes('REPORT'))).toBe(true);
    expect(stageNames.some((t) => t?.includes('CLEANUP'))).toBe(true);
  });

  it('displays parallel reviewer runs with state badges', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('gpt-4o');
    expect(el.textContent).toContain('gemini-1.5-pro');

    const runningBadges = el.querySelectorAll('.badge-running');
    expect(runningBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('renders collapsed sanitized log elements for reviewers', () => {
    const el = fixture.nativeElement as HTMLElement;
    const logDetails = el.querySelectorAll('details.sanitized-log');
    expect(logDetails.length).toBeGreaterThanOrEqual(2);
    // Collapsed by default
    expect((logDetails[0] as HTMLDetailsElement).open).toBe(false);
  });

  it('triggers cancellation workflow on cancel button click', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const cancelBtn = el.querySelector<HTMLButtonElement>('#cancel-review-btn');
    expect(cancelBtn).toBeTruthy();

    cancelBtn?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(apiClientMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: `/api/reviews/${mockActiveJob.id}/cancel`,
      }),
    );
  });

  it('displays warnings list including fallback standards notice', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Detected framework guidance used as fallback standards');
  });

  it('navigates to report or displays link when review job completes', async () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));

    eventsSubject.next({
      reviewId: mockActiveJob.id,
      sequence: 10,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'completed' },
    });

    fixture.detectChanges();
    await fixture.whenStable();

    expect(navSpy).toHaveBeenCalledWith([`/reviews/${mockActiveJob.id}`]);
  });
});
