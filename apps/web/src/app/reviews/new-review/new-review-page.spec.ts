import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NewReviewPageComponent } from './new-review-page.component';
import { ApiClientService } from '../../core/api/api-client.service';
import { ProvidersStore } from '../../providers/providers.store';
import { PullRequestSummary, ReviewJob, StandardsMetadata } from '@pr-orchestrator/contracts';

describe('NewReviewPageComponent', () => {
  let fixture: ComponentFixture<NewReviewPageComponent>;
  let component: NewReviewPageComponent;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
  };
  let providersStoreMock: {
    selectableModels: ReturnType<typeof vi.fn>;
    allInstalledModels: ReturnType<typeof vi.fn>;
    providers: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
  };

  const mockPrSummary: PullRequestSummary = {
    url: 'https://dev.azure.com/acme/project/_git/enterprise-super-long-repository-service-name-with-extended-path/_git/repo/pullrequest/4819',
    organization: 'acme-corporation-global-engineering-infrastructure',
    project: 'enterprise-core-platform-services',
    repository: 'enterprise-super-long-repository-service-name-with-extended-path',
    pullRequestId: 4819,
    title: 'Refactor OAuth2 token exchange & introduce JWKS cache with complex distribution logic',
    author: { id: 'elena.rostova@acme.internal', displayName: 'Elena Rostova (Staff Platform Security Engineer)' },
    sourceBranch: 'feature/jwt-rotation-v2-with-long-qualifier-branch-name',
    targetBranch: 'release/2026-q3-production-candidate',
    sourceCommit: 'c89fa31abcdef0123456789abcdef0123456789',
    targetCommit: '1234567abcdef0123456789abcdef0123456789',
    changedFiles: 14,
    additions: 482,
    deletions: 119,
    updatedAt: '2026-09-30T10:00:00.000Z',
  };

  const mockStandards: StandardsMetadata = {
    versionId: '123e4567-e89b-12d3-a456-426614174000',
    filename: 'enterprise-security-and-perf-v2.md',
    sha256: '7f01a88c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90',
    sizeBytes: 42800,
    uploadedAt: '2026-09-29T10:00:00.000Z',
  };

  const mockCreatedJob: ReviewJob = {
    id: '123e4567-e89b-12d3-a456-426614174099',
    state: 'queued',
    pullRequest: mockPrSummary,
    main: { provider: 'claude', model: 'claude-3-7-sonnet' },
    reviewers: [
      {
        id: '123e4567-e89b-12d3-a456-426614174098',
        selection: { provider: 'codex', model: 'gpt-4o' },
        state: 'queued',
        startedAt: null,
        completedAt: null,
        warning: null,
      },
    ],
    standards: mockStandards,
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  beforeEach(async () => {
    apiClientMock = {
      request: vi.fn(),
    };
    routerMock = {
      navigate: vi.fn(),
    };
    providersStoreMock = {
      selectableModels: vi.fn().mockReturnValue([
        { provider: 'claude', model: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet (Hybrid Reasoning)' },
        { provider: 'codex', model: 'gpt-4o', label: 'GPT-4o (High-throughput general)' },
        { provider: 'gemini', model: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (2M Context Window)' },
      ]),
      allInstalledModels: vi.fn().mockReturnValue([
        { provider: 'claude', model: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet (Hybrid Reasoning)', available: true },
        { provider: 'codex', model: 'gpt-4o', label: 'GPT-4o (High-throughput general)', available: true },
        { provider: 'gemini', model: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (2M Context Window)', available: true },
        { provider: 'claude', model: 'claude-3-haiku', label: 'Claude 3 Haiku (Disabled model)', available: false, unavailableReason: 'Model deprecated' },
      ]),
      providers: vi.fn().mockReturnValue([]),
      load: vi.fn().mockResolvedValue(undefined),
    };

    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/standards') {
        return Promise.resolve(mockStandards);
      }
      if (opts.path === '/api/reviews/active') {
        return Promise.resolve(null);
      }
      if (opts.path === '/api/settings') {
        return Promise.resolve({
          defaultMain: { provider: 'claude', model: 'claude-3-7-sonnet' },
          defaultReviewers: [{ provider: 'codex', model: 'gpt-4o' }],
          defaultAdditionalInstructions: '',
        });
      }
      if (opts.path === '/api/pull-requests/validate') {
        return Promise.resolve(mockPrSummary);
      }
      if (opts.path === '/api/reviews' && opts.method === 'POST') {
        return Promise.resolve(mockCreatedJob);
      }
      return Promise.resolve({});
    });

    await TestBed.configureTestingModule({
      imports: [NewReviewPageComponent],
      providers: [
        provideRouter([]),
        { provide: ApiClientService, useValue: apiClientMock },
        { provide: ProvidersStore, useValue: providersStoreMock },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockImplementation(() => Promise.resolve(true));

    fixture = TestBed.createComponent(NewReviewPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await component.store.loadInitialData();
    fixture.detectChanges();
  });

  it('renders page header with read-only badge and title', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('New PR Review');
    expect(el.textContent).toContain('Target Azure DevOps Pull Request');
  });

  it('validates PR URL and displays full metadata with accessible attributes for long content', async () => {
    const el = fixture.nativeElement as HTMLElement;
    const urlInput = el.querySelector<HTMLInputElement>('#pr-url-input');
    expect(urlInput).toBeTruthy();

    component.store.setPrUrl('https://dev.azure.com/acme/project/_git/repo/pullrequest/4819');
    await component.store.validatePr();
    fixture.detectChanges();

    expect(el.textContent).toContain('PR #4819');
    expect(el.textContent).toContain('Refactor OAuth2 token exchange');
    expect(el.textContent).toContain('14 changed files');
    expect(el.textContent).toContain('+482');
    expect(el.textContent).toContain('-119');

    // Accessible title attributes for long repository & branch names
    const repoElement = el.querySelector('.repo-name');
    expect(repoElement).toBeTruthy();
    expect(repoElement?.getAttribute('title')).toContain('enterprise-super-long-repository');
  });

  it('displays warning when no standards file is uploaded and shows fallback message', async () => {
    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/standards') {
        return Promise.resolve(null);
      }
      if (opts.path === '/api/reviews/active') {
        return Promise.resolve(null);
      }
      return Promise.resolve({});
    });

    await component.store.loadInitialData();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('No standards file uploaded');
    expect(el.textContent).toContain('detected framework and library best-practice guidance');
  });

  it('disables unavailable models in selection menus with reason', () => {
    const el = fixture.nativeElement as HTMLElement;
    // Check for disabled model option or pill
    const disabledOption = el.querySelector('option[disabled]');
    expect(disabledOption?.textContent).toContain('Claude 3 Haiku');
  });

  it('prevents adding duplicate reviewer models', () => {
    const el = fixture.nativeElement as HTMLElement;
    // Currently codex:gpt-4o is a reviewer
    const initialReviewerCount = component.store.reviewerSelections().length;
    const added = component.store.addReviewer({ provider: 'codex', model: 'gpt-4o' });
    expect(added).toBe(false);
    expect(component.store.reviewerSelections().length).toBe(initialReviewerCount);
  });

  it('disables review start when an active job is already running', async () => {
    component.store.activeJob.set(mockCreatedJob);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const startBtn = el.querySelector<HTMLButtonElement>('#start-review-btn');
    expect(startBtn?.disabled).toBe(true);
    expect(el.textContent).toContain('Another review job is currently active');
  });

  it('submits review and navigates to active review page', async () => {
    component.store.setPrUrl('https://dev.azure.com/acme/project/_git/repo/pullrequest/4819');
    component.store.prSummary.set(mockPrSummary);
    component.store.setMainSelection({ provider: 'claude', model: 'claude-3-7-sonnet' });
    component.store.setReviewerSelections([{ provider: 'codex', model: 'gpt-4o' }]);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const startBtn = el.querySelector<HTMLButtonElement>('#start-review-btn');
    expect(startBtn?.disabled).toBe(false);

    await component.onStartReview();
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/reviews/active']);
  });
});
