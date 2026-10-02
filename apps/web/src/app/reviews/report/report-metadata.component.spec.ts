import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportMetadataComponent } from './report-metadata.component';
import { ReviewJob, VerifiedReport } from '@pr-orchestrator/contracts';

describe('ReportMetadataComponent', () => {
  let fixture: ComponentFixture<ReportMetadataComponent>;
  let component: ReportMetadataComponent;

  const mockJob: ReviewJob = {
    id: '123e4567-e89b-12d3-a456-426614174099',
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
    ],
    standards: null,
    warnings: [],
    createdAt: '2026-09-30T10:00:00.000Z',
    updatedAt: '2026-09-30T10:00:30.000Z',
    completedAt: '2026-09-30T10:00:30.000Z',
  };

  const mockReport: VerifiedReport = {
    reviewId: mockJob.id,
    overallRisk: 'low',
    executiveSummary: 'Executive summary text.',
    acceptedCount: 1,
    rejectedCount: 0,
    mergedCount: 0,
    findings: [],
    decisions: [],
    exclusions: [],
    warnings: [],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportMetadataComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportMetadataComponent);
    component = fixture.componentInstance;
  });

  it('renders attached guidance filename, hash, and size when repositoryGuidance is present', () => {
    fixture.componentRef.setInput('job', {
      ...mockJob,
      repositoryGuidance: {
        filename: 'GEMINI.md',
        sha256: '5d41402abc4b2a76b9719d911017c5926c043e0616b3fbc958ea2877a565d70f',
        sizeBytes: 4096,
      },
    });
    fixture.componentRef.setInput('report', mockReport);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const guidanceItem = el.querySelector('#meta-guidance');
    expect(guidanceItem).toBeTruthy();
    expect(guidanceItem?.textContent).toContain('GEMINI.md');
    expect(guidanceItem?.textContent).toContain('5d41402a');
    expect(guidanceItem?.textContent).toContain('4.0 KB');
    expect(guidanceItem?.textContent).toContain('5d41402abc4b2a76b9719d911017c5926c043e0616b3fbc958ea2877a565d70f');
  });

  it('renders normally without guidance metadata item for historical reviews without repositoryGuidance', () => {
    fixture.componentRef.setInput('job', mockJob);
    fixture.componentRef.setInput('report', mockReport);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#meta-guidance')).toBeNull();
    expect(el.textContent).toContain('Detected library fallback guidance');
  });
});
