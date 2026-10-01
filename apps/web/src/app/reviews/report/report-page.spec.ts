import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { ReportPageComponent } from './report-page.component';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReviewEventsService } from '../../core/api/review-events.service';
import { ReportIntegrationService } from './report-integration.service';
import { ReviewJob, VerifiedReport } from '@pr-orchestrator/contracts';

describe('ReportPageComponent', () => {
  let fixture: ComponentFixture<ReportPageComponent>;
  let component: ReportPageComponent;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let eventsSubject: Subject<any>;
  let paramMapSubject: BehaviorSubject<Map<string, string>>;
  let eventsServiceMock: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };

  const reviewId = '123e4567-e89b-12d3-a456-426614174099';

  const mockJob: ReviewJob = {
    id: reviewId,
    state: 'completed',
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
        id: '123e4567-e89b-12d3-a456-426614174001',
        selection: { provider: 'codex', model: 'gpt-4o' },
        state: 'completed',
        startedAt: '2026-09-30T10:00:00.000Z',
        completedAt: '2026-09-30T10:00:25.000Z',
        warning: null,
      },
      {
        id: '123e4567-e89b-12d3-a456-426614174002',
        selection: { provider: 'gemini', model: 'gemini-1.5-pro' },
        state: 'completed',
        startedAt: '2026-09-30T10:00:00.000Z',
        completedAt: '2026-09-30T10:00:28.000Z',
        warning: null,
      },
    ],
    standards: null,
    warnings: ['Fallback standards guidance used.'],
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:45.000Z',
    completedAt: '2026-09-30T10:00:45.000Z',
  };

  const mockReport: VerifiedReport = {
    reviewId,
    overallRisk: 'critical',
    executiveSummary: 'This PR introduces OAuth2 token exchange with high overall security risk due to improper token invalidation and concurrency race in the cache.',
    findings: [
      {
        id: '123e4567-e89b-12d3-a456-426614174011',
        title: 'Missing revocation check during token exchange',
        severity: 'critical',
        filePath: 'src/auth/token_exchange.go',
        location: { startLine: 142, endLine: 158 },
        evidence: 'Token is granted without checking the revocation blocklist in Redis.',
        impact: 'Revoked parent tokens can continue minting child tokens indefinitely.',
        suggestedFix: 'Query the blacklist service before issuing refreshed tokens.',
        reference: 'RFC 6749 Section 5.2',
        origins: [{ provider: 'codex', model: 'gpt-4o' }, { provider: 'gemini', model: 'gemini-1.5-pro' }],
      },
      {
        id: '123e4567-e89b-12d3-a456-426614174012',
        title: 'Concurrent map read/write in JWKS memory cache',
        severity: 'high',
        filePath: 'src/jwks/cache.go',
        location: { startLine: 88, endLine: 95 },
        evidence: 'cache.keys[kid] accessed without RLock.',
        impact: 'Panic crash under high concurrent traffic spikes.',
        suggestedFix: 'Use sync.RWMutex around all key map accesses.',
        origins: [{ provider: 'codex', model: 'gpt-4o' }],
      },
    ],
    decisions: [
      {
        candidateIds: ['123e4567-e89b-12d3-a456-426614174021'],
        verdict: 'rejected',
        rationale: 'Reviewer claimed SQL injection, but parameter binding is enforced by GORM ORM.',
      },
    ],
    acceptedCount: 2,
    rejectedCount: 1,
    mergedCount: 0,
    warnings: ['Fallback standards guidance used.'],
    exclusions: [{ path: 'vendor/**', reason: 'Third-party dependencies excluded' }],
  };

  const defaultFetchHandler = (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/api/reviews/${reviewId}`) {
      return Promise.resolve(
        new Response(JSON.stringify(mockJob), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url === `/api/reviews/${reviewId}/report`) {
      return Promise.resolve(
        new Response(JSON.stringify(mockReport), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url === `/api/reviews/${reviewId}/report.md`) {
      return Promise.resolve(
        new Response('# PR #4819 Markdown Report Content', {
          status: 200,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        }),
      );
    }
    if (url === '/api/reviews/active') {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response('Not Found', { status: 404 }));
  };

  beforeEach(async () => {
    paramMapSubject = new BehaviorSubject(new Map([['reviewId', reviewId]]));
    eventsSubject = new Subject();
    eventsServiceMock = {
      connect: vi.fn().mockReturnValue(eventsSubject.asObservable()),
      disconnect: vi.fn(),
    };

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(defaultFetchHandler);

    await TestBed.configureTestingModule({
      imports: [ReportPageComponent],
      providers: [
        provideRouter([]),
        ApiClientService,
        ReportIntegrationService,
        { provide: ReviewEventsService, useValue: eventsServiceMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: new Map([['reviewId', reviewId]]) },
            paramMap: paramMapSubject.asObservable(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.loadReportData();
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders executive summary, metadata, and overall risk badge', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('PR #4819');
    expect(el.textContent).toContain('CRITICAL RISK');
    expect(el.textContent).toContain('This PR introduces OAuth2 token exchange');
    expect(el.textContent).toContain('claude-3-7-sonnet');
  });

  it.each(['completed', 'cancelled', 'failed'] as const)('keeps reviewer and verifier activity accessible for %s reviews', async state => {
    const run = mockJob.reviewers[0];
    const item = { id: `${run.id}:2`, runId: run.id, seq: 2, at: '2026-09-30T10:00:20.000Z', kind: 'provider' as const, action: 'thinking' as const };
    component.job.set({ ...mockJob, state, reviewers: [{ ...run, activity: { visibility: 'full', recent: [item], current: item, lastActivityAt: item.at, lastHeartbeatAt: null, total: 2 } }], verifier: { ...mockJob.reviewers[1], selection: mockJob.main } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('app-reviewer-run-card')).toHaveLength(2);
    const older = { ...item, id: `${run.id}:1`, seq: 1, at: '2026-09-30T10:00:10.000Z' };
    fetchSpy.mockImplementation((input: RequestInfo | URL) => String(input).endsWith('/activity')
      ? Promise.resolve(new Response(JSON.stringify({ runId: run.id, items: [older, item], total: 2 }), { status: 200 }))
      : defaultFetchHandler(input));
    const details = fixture.nativeElement.querySelector('app-run-activity-log details') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.job()?.reviewers[0].activity?.recent).toEqual([older, item]);
  });

  it('renders verified findings ordered by severity with location and fixes', () => {
    const el = fixture.nativeElement as HTMLElement;
    const findings = el.querySelectorAll('.finding-card');
    expect(findings.length).toBe(2);

    expect(findings[0].textContent).toContain('CRITICAL');
    expect(findings[0].textContent).toContain('Missing revocation check');
    expect(findings[0].textContent).toContain('src/auth/token_exchange.go:142-158');
    expect(findings[0].textContent).toContain('Revoked parent tokens can continue minting');

    expect(findings[1].textContent).toContain('HIGH');
    expect(findings[1].textContent).toContain('Concurrent map read/write');
  });

  it('displays origins of findings pairing model pills and providers', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('gpt-4o');
    expect(el.textContent).toContain('gemini-1.5-pro');
  });

  it('displays collapsed rejected claims audit with verifier rationale', () => {
    const el = fixture.nativeElement as HTMLElement;
    const auditDetails = el.querySelector('details.rejected-claims-audit');
    expect(auditDetails).toBeTruthy();
    expect(auditDetails?.textContent).toContain('Reviewer claimed SQL injection, but parameter binding is enforced');
  });

  it('displays coverage exclusions and fallback warnings', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('vendor/**');
    expect(el.textContent).toContain('Fallback standards guidance used');
  });

  it('renders clean state when report has zero verified findings', async () => {
    const cleanReport: VerifiedReport = {
      ...mockReport,
      overallRisk: 'clean',
      findings: [],
      acceptedCount: 0,
    };

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}/report`) {
        return Promise.resolve(
          new Response(JSON.stringify(cleanReport), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No Verified Findings');
  });

  it('handles copy markdown with exact canonical backend markdown and without null or JSON encoding', async () => {
    let copiedText = '';
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn((text: string) => {
          copiedText = text;
          return Promise.resolve();
        }),
      },
    });

    await component.copyMarkdown();
    fixture.detectChanges();

    expect(copiedText).toBe('# PR #4819 Markdown Report Content');
    expect(copiedText).not.toBe('null');
    expect(copiedText).not.toContain('"# PR #4819');
    expect(component.copySuccess()).toBe(true);
    expect(component.actionError()).toBeNull();
  });

  it('handles failed copy request without fabricating markdown, setting actionable error and allowing retry', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}/report.md`) {
        return Promise.resolve(new Response('Service Unavailable', { status: 503 }));
      }
      return defaultFetchHandler(input);
    });

    await component.copyMarkdown();
    fixture.detectChanges();

    expect(writeTextMock).not.toHaveBeenCalled();
    expect(component.copySuccess()).toBe(false);
    expect(component.actionError()).toContain('Copy failed');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.action-error-banner')).toBeTruthy();

    // Now test retry: backend recovers
    fetchSpy.mockImplementation(defaultFetchHandler);
    component.retryLastAction();
    await new Promise((r) => setTimeout(r, 10));
    fixture.detectChanges();

    expect(writeTextMock).toHaveBeenCalledWith('# PR #4819 Markdown Report Content');
    expect(component.copySuccess()).toBe(true);
  });

  it('handles download markdown using real Response text/markdown and does not fabricate download on failure', async () => {
    let createdBlobText = '';
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blob.text().then((t) => (createdBlobText = t));
      return 'blob:mock-url';
    });
    URL.revokeObjectURL = vi.fn();

    await component.downloadMarkdown();
    fixture.detectChanges();

    await new Promise((r) => setTimeout(r, 10));
    expect(createdBlobText).toBe('# PR #4819 Markdown Report Content');
    expect(createdBlobText).not.toBe('null');

    // Test failed download
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}/report.md`) {
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      }
      return defaultFetchHandler(input);
    });

    const createObjectURLCount = (URL.createObjectURL as any).mock.calls.length;
    await component.downloadMarkdown();
    fixture.detectChanges();

    expect((URL.createObjectURL as any).mock.calls.length).toBe(createObjectURLCount);
    expect(component.actionError()).toContain('Download failed');

    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it('produces a controlled error when ReviewJob response fails schema validation and does not render findings', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: 'invalid-job', state: 'unknown_state' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.job()).toBeNull();
    expect(component.report()).toBeNull();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error-banner')).toBeTruthy();
    expect(el.querySelectorAll('.finding-card').length).toBe(0);
  });

  it('produces a controlled error when VerifiedReport fails schema validation and does not render findings', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}/report`) {
        return Promise.resolve(
          new Response(JSON.stringify({ reviewId: 'not-a-uuid', findings: 'invalid' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    expect(component.job()).toBeNull();
    expect(component.report()).toBeNull();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error-banner')).toBeTruthy();
    expect(el.querySelectorAll('.finding-card').length).toBe(0);
  });

  it('handles absent structured-report endpoint (404) gracefully with error banner and retry action', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}/report`) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'Route GET /api/reviews/:reviewId/report not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.error()).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.error-banner')).toBeTruthy();
    expect(el.querySelectorAll('.finding-card').length).toBe(0);
  });

  it('renders active pipeline view when direct navigation or refresh occurs on an active job, without calling report endpoint', async () => {
    const activeJob: ReviewJob = {
      ...mockJob,
      state: 'reviewing',
    };

    let reportCalled = false;
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(activeJob), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.includes('/report')) {
        reportCalled = true;
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(reportCalled).toBe(false);
    expect(component.isInProgress()).toBe(true);
    expect(eventsServiceMock.connect).toHaveBeenCalledWith(reviewId);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.telemetry-strip')).toBeTruthy();
    expect(el.querySelector('app-pipeline-stage-list')).toBeTruthy();
    expect(el.querySelector('.reviewers-section')).toBeTruthy();
    expect(el.querySelector('#cancel-review-btn')).toBeTruthy();
    expect(el.querySelectorAll('.finding-card').length).toBe(0);
  });

  it('renders failed review diagnostic view without requesting report or fabricating findings', async () => {
    const failedJob: ReviewJob = {
      ...mockJob,
      state: 'failed',
      reviewers: [
        {
          ...mockJob.reviewers[0],
          state: 'failed',
        },
        mockJob.reviewers[1],
      ],
      warnings: ['CLI process crashed due to timeout'],
    };

    let reportCalled = false;
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(failedJob), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.includes('/report')) {
        reportCalled = true;
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(reportCalled).toBe(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.failed-banner')).toBeTruthy();
    expect(el.textContent).toContain('Review Pipeline Execution Failed');
    expect(el.textContent).toContain('gpt-4o');
    expect(el.textContent).toContain('CLI process crashed due to timeout');
    expect(el.querySelectorAll('.finding-card').length).toBe(0);
    expect(component.report()).toBeNull();
  });

  it('renders cancelled review view without requesting report', async () => {
    const cancelledJob: ReviewJob = {
      ...mockJob,
      state: 'cancelled',
    };

    let reportCalled = false;
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(cancelledJob), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url.includes('/report')) {
        reportCalled = true;
        return Promise.resolve(new Response('Not Found', { status: 404 }));
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(reportCalled).toBe(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.cancelled-banner')).toBeTruthy();
    expect(el.textContent).toContain('Review Cancelled');
  });

  it('displays clear data-consistency error and recovery actions when completed job is missing stored report', async () => {
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}/report`) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'No report is available for this review.' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.isDataConsistencyError()).toBe(true);
    expect(component.error()).toContain('No report is available');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('DATA CONSISTENCY ERROR');
    expect(el.querySelector('.error-nav-actions')).toBeTruthy();
    expect(el.textContent).toContain('Retry');
    expect(el.textContent).toContain('Review History');
    expect(el.textContent).toContain('New Review');
  });

  it('discards late HTTP responses and mismatched SSE events when switching reviews', async () => {
    const jobAId = '11111111-1111-4111-8111-111111111111';
    const jobBId = '22222222-2222-4222-8222-222222222222';
    const jobA: ReviewJob = { ...mockJob, id: jobAId };
    const jobB: ReviewJob = { ...mockJob, id: jobBId };
    const reportB: VerifiedReport = { ...mockReport, reviewId: jobBId };

    let resolveJobA: (value: Response) => void;
    const pendingJobA = new Promise<Response>((resolve) => {
      resolveJobA = resolve;
    });

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${jobAId}`) {
        return pendingJobA;
      }
      if (url === `/api/reviews/${jobBId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(jobB), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url === `/api/reviews/${jobBId}/report`) {
        return Promise.resolve(
          new Response(JSON.stringify(reportB), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    const route = TestBed.inject(ActivatedRoute);
    (route.snapshot as any).paramMap = new Map([['reviewId', jobAId]]);
    const promiseA = component.loadReportData();

    (route.snapshot as any).paramMap = new Map([['reviewId', jobBId]]);
    await component.loadReportData();

    expect(component.job()?.id).toBe(jobBId);

    // Resolve Job A late
    resolveJobA!(
      new Response(JSON.stringify(jobA), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await promiseA;

    // Component must still hold Job B
    expect(component.job()?.id).toBe(jobB.id);

    // Mismatched SSE event from jobA is ignored
    eventsSubject.next({
      reviewId: jobA.id,
      sequence: 99,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'failed' },
    });
    expect(component.job()?.id).toBe(jobB.id);
  });

  it('smoothly transitions from active pipeline to verified report when SSE terminal completed event arrives', async () => {
    const activeJob: ReviewJob = {
      ...mockJob,
      state: 'reviewing',
    };

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(activeJob), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.isInProgress()).toBe(true);

    fetchSpy.mockImplementation(defaultFetchHandler);

    eventsSubject.next({
      reviewId,
      sequence: 20,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'completed' },
    });

    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.report()).toBeTruthy();
    expect(component.isInProgress()).toBe(false);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.findings-section')).toBeTruthy();
  });

  it('loads and renders a completed review when reasoningEffort is present in model selections and findings origins', async () => {
    const jobWithReasoningEffort: ReviewJob = {
      ...mockJob,
      main: { provider: 'claude', model: 'claude-3-7-sonnet', reasoningEffort: 'medium' },
      reviewers: [
        {
          ...mockJob.reviewers[0],
          selection: { provider: 'codex', model: 'gpt-4o', reasoningEffort: 'high' },
        },
        {
          ...mockJob.reviewers[1],
          selection: { provider: 'gemini', model: 'gemini-1.5-pro', reasoningEffort: 'default' },
        },
      ],
    };

    const reportWithReasoningEffort: VerifiedReport = {
      ...mockReport,
      findings: [
        {
          ...mockReport.findings[0],
          origins: [{ provider: 'codex', model: 'gpt-4o', reasoningEffort: 'high' }],
        },
        mockReport.findings[1],
      ],
      decisions: mockReport.decisions,
    };

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(jobWithReasoningEffort), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url === `/api/reviews/${reviewId}/report`) {
        return Promise.resolve(
          new Response(JSON.stringify(reportWithReasoningEffort), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.report()).toBeTruthy();
    expect(component.job()?.main.reasoningEffort).toBe('medium');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.summary-text')?.textContent).toContain('OAuth2 token exchange');
    expect(el.querySelectorAll('.finding-card').length).toBe(2);
  });

  it('loads and renders a failed review with reasoningEffort, mapping stages and showing actual warning without fabricated logs', async () => {
    const failedJob: ReviewJob = {
      ...mockJob,
      state: 'failed',
      main: { provider: 'claude', model: 'claude-3-7-sonnet', reasoningEffort: 'medium' },
      reviewers: [
        {
          id: '123e4567-e89b-12d3-a456-426614174001',
          selection: { provider: 'gemini', model: 'flash', reasoningEffort: 'default' },
          state: 'failed',
          startedAt: '2026-09-30T10:00:00.000Z',
          completedAt: '2026-09-30T10:00:04.000Z',
          warning: 'gemini exited with code 41: its signed-in account is not eligible for this CLI.',
        },
      ],
      warnings: [
        'Failed during reviewing: All reviewers failed. gemini/flash: gemini exited with code 41: its signed-in account is not eligible for this CLI.',
      ],
    };

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(failedJob), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.error()).toBeNull();
    expect(component.report()).toBeNull();
    expect(component.job()?.state).toBe('failed');

    const stages = component.stageStatuses();
    // Stages 1-4 completed
    expect(stages.find((s) => s.key === 'validate')?.status).toBe('completed');
    expect(stages.find((s) => s.key === 'checkout')?.status).toBe('completed');
    expect(stages.find((s) => s.key === 'detect')?.status).toBe('completed');
    expect(stages.find((s) => s.key === 'standards')?.status).toBe('completed');
    // Stage 5 failed
    expect(stages.find((s) => s.key === 'reviewers')?.status).toBe('failed');
    // Stages 6-7 not run
    expect(stages.find((s) => s.key === 'verify')?.status).toBe('not_run');
    expect(stages.find((s) => s.key === 'report')?.status).toBe('not_run');
    // Stage 8 cleanup completed
    expect(stages.find((s) => s.key === 'cleanup')?.status).toBe('completed');

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.failed-banner')).toBeTruthy();
    expect(el.textContent).toContain('gemini exited with code 41');
    expect(el.textContent).not.toContain('[orchestrator:init]');
    expect(el.textContent).not.toContain('[orchestrator:redact]');
  });

  it('reacts to route paramMap changes and loads new review data when switching review IDs', async () => {
    const jobBId = '33333333-3333-4333-8333-333333333333';
    const jobB: ReviewJob = {
      ...mockJob,
      id: jobBId,
      pullRequest: {
        ...mockJob.pullRequest,
        pullRequestId: 9999,
        title: 'Switched Target PR Title',
      },
    };
    const reportB: VerifiedReport = {
      ...mockReport,
      reviewId: jobBId,
      executiveSummary: 'Executive summary for switched job B.',
    };

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${jobBId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(jobB), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      if (url === `/api/reviews/${jobBId}/report`) {
        return Promise.resolve(
          new Response(JSON.stringify(reportB), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    paramMapSubject.next(new Map([['reviewId', jobBId]]));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.job()?.id).toBe(jobBId);
    expect(component.report()?.executiveSummary).toBe('Executive summary for switched job B.');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('PR #9999');
    expect(el.textContent).toContain('Switched Target PR Title');
  });

  it('loads and renders a cancelled review, displaying cancellation details', async () => {
    const cancelledJob: ReviewJob = {
      ...mockJob,
      state: 'cancelled',
      reviewers: [
        {
          ...mockJob.reviewers[0],
          state: 'cancelled',
          warning: null,
        },
      ],
    };

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(cancelledJob), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.job()?.state).toBe('cancelled');
    expect(component.report()).toBeNull();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.cancelled-banner')).toBeTruthy();
    expect(el.textContent).toContain('Review Cancelled');
    expect(el.textContent).toContain('Review orchestration was cancelled. Child CLI processes were terminated.');
    expect(el.querySelector('#cancel-review-btn')).toBeFalsy();
  });

  it('loads and renders an active review, restoring progress and connecting SSE', async () => {
    const activeJob: ReviewJob = {
      ...mockJob,
      state: 'reviewing',
      reviewers: [
        {
          ...mockJob.reviewers[0],
          state: 'running',
          warning: null,
        },
      ],
    };

    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `/api/reviews/${reviewId}`) {
        return Promise.resolve(
          new Response(JSON.stringify(activeJob), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }
      return defaultFetchHandler(input);
    });

    await component.loadReportData();
    fixture.detectChanges();

    expect(component.job()?.state).toBe('reviewing');
    expect(component.isInProgress()).toBe(true);
    expect(component.canCancel()).toBe(true);
    expect(eventsServiceMock.connect).toHaveBeenCalledWith(reviewId);

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#cancel-review-btn')).toBeTruthy();
    expect(el.querySelector('.telemetry-strip')).toBeTruthy();
    expect(el.querySelector('app-pipeline-stage-list')).toBeTruthy();
  });
});
