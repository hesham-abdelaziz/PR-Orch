import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ReportPageComponent } from './report-page.component';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReviewJob, VerifiedReport } from '@pr-orchestrator/contracts';

describe('ReportPageComponent', () => {
  let fixture: ComponentFixture<ReportPageComponent>;
  let component: ReportPageComponent;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
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
        id: 'rev-1',
        selection: { provider: 'codex', model: 'gpt-4o' },
        state: 'completed',
        startedAt: '2026-09-30T10:00:00.000Z',
        completedAt: '2026-09-30T10:00:25.000Z',
        warning: null,
      },
      {
        id: 'rev-2',
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
        id: 'f-1',
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
        id: 'f-2',
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
        candidateIds: ['cand-1'],
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

  beforeEach(async () => {
    apiClientMock = {
      request: vi.fn(),
    };

    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === `/api/reviews/${reviewId}`) {
        return Promise.resolve(mockJob);
      }
      if (opts.path === `/api/reviews/${reviewId}/report`) {
        return Promise.resolve(mockReport);
      }
      if (opts.path === `/api/reviews/${reviewId}/report.md`) {
        return Promise.resolve('# PR #4819 Markdown Report Content');
      }
      return Promise.resolve({});
    });

    await TestBed.configureTestingModule({
      imports: [ReportPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: apiClientMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: new Map([['reviewId', reviewId]]) },
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

  it('renders executive summary, metadata, and overall risk badge', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('PR #4819');
    expect(el.textContent).toContain('CRITICAL RISK');
    expect(el.textContent).toContain('This PR introduces OAuth2 token exchange');
    expect(el.textContent).toContain('claude-3-7-sonnet');
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

    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === `/api/reviews/${reviewId}/report`) {
        return Promise.resolve(cleanReport);
      }
      return Promise.resolve(mockJob);
    });

    await component.loadReportData();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No Verified Findings');
  });
});
