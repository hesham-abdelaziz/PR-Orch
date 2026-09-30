import { TestBed } from '@angular/core/testing';
import { NewReviewStore } from './new-review.store';
import { ApiClientService } from '../../core/api/api-client.service';
import { ProvidersStore } from '../../providers/providers.store';
import {
  PullRequestSummary,
  ReviewJob,
  StandardsMetadata,
} from '@pr-orchestrator/contracts';
import { ApiError } from '../../core/api/api-error';

describe('NewReviewStore', () => {
  let store: NewReviewStore;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };
  let providersStoreMock: {
    selectableModels: ReturnType<typeof vi.fn>;
    providers: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
  };

  const mockPrSummary: PullRequestSummary = {
    url: 'https://dev.azure.com/acme/project/_git/repo/pullrequest/123',
    organization: 'acme',
    project: 'project',
    repository: 'repo',
    pullRequestId: 123,
    title: 'Feat: Add authentication caching',
    author: { id: 'usr-1', displayName: 'Jane Doe' },
    sourceBranch: 'feature/auth-cache',
    targetBranch: 'main',
    sourceCommit: 'abcdef1234567',
    targetCommit: '7654321fedcba',
    changedFiles: 5,
    additions: 120,
    deletions: 30,
    updatedAt: new Date().toISOString(),
  };

  const mockStandards: StandardsMetadata = {
    versionId: '123e4567-e89b-12d3-a456-426614174000',
    filename: 'standards.md',
    sha256: 'a'.repeat(64),
    sizeBytes: 2048,
    uploadedAt: new Date().toISOString(),
  };

  const mockCreatedJob: ReviewJob = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    state: 'queued',
    pullRequest: mockPrSummary,
    main: { provider: 'claude', model: 'claude-3-7-sonnet' },
    reviewers: [
      {
        id: '123e4567-e89b-12d3-a456-426614174002',
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

  beforeEach(() => {
    apiClientMock = {
      request: vi.fn(),
    };
    providersStoreMock = {
      selectableModels: vi.fn().mockReturnValue([
        { provider: 'claude', model: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', available: true },
        { provider: 'codex', model: 'gpt-4o', label: 'GPT-4o', available: true },
        { provider: 'gemini', model: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', available: false },
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
      return Promise.resolve({});
    });

    TestBed.configureTestingModule({
      providers: [
        NewReviewStore,
        { provide: ApiClientService, useValue: apiClientMock },
        { provide: ProvidersStore, useValue: providersStoreMock },
      ],
    });

    store = TestBed.inject(NewReviewStore);
  });

  it('initializes with default models and loads standards and active review state', async () => {
    await store.loadInitialData();

    expect(store.mainSelection()).toEqual({ provider: 'claude', model: 'claude-3-7-sonnet' });
    expect(store.reviewerSelections()).toEqual([{ provider: 'codex', model: 'gpt-4o' }]);
    expect(store.standards()).toEqual(mockStandards);
    expect(store.activeJob()).toBeNull();
    expect(store.missingStandards()).toBe(false);
  });

  it('validates PR URL and stores summary on success', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockPrSummary);

    store.setPrUrl('https://dev.azure.com/acme/project/_git/repo/pullrequest/123');
    await store.validatePr();

    expect(store.prSummary()).toEqual(mockPrSummary);
    expect(store.prError()).toBeNull();
    expect(store.validatingPr()).toBe(false);
  });

  it('invalidates prior PR summary when URL is modified', async () => {
    apiClientMock.request.mockResolvedValueOnce(mockPrSummary);
    store.setPrUrl('https://dev.azure.com/acme/project/_git/repo/pullrequest/123');
    await store.validatePr();
    expect(store.prSummary()).toBeTruthy();

    store.setPrUrl('https://dev.azure.com/acme/project/_git/repo/pullrequest/999');
    expect(store.prSummary()).toBeNull();
    expect(store.prError()).toBeNull();
  });

  it('preserves provider selections after a PR validation error', async () => {
    store.setMainSelection({ provider: 'claude', model: 'claude-3-7-sonnet' });
    store.setReviewerSelections([{ provider: 'codex', model: 'gpt-4o' }]);

    apiClientMock.request.mockRejectedValueOnce(
      new ApiError(404, 'PR_NOT_FOUND', 'Pull request was not found in Azure DevOps'),
    );

    store.setPrUrl('https://dev.azure.com/acme/project/_git/repo/pullrequest/99999');
    await store.validatePr();

    expect(store.prSummary()).toBeNull();
    expect(store.prError()).toBe('Pull request was not found in Azure DevOps');
    // Model selections preserved
    expect(store.mainSelection()).toEqual({ provider: 'claude', model: 'claude-3-7-sonnet' });
    expect(store.reviewerSelections()).toEqual([{ provider: 'codex', model: 'gpt-4o' }]);
  });

  it('enforces exact-one-main and at-least-one-reviewer', () => {
    store.setMainSelection(null as any);
    expect(store.canSubmit()).toBe(false);

    store.setMainSelection({ provider: 'claude', model: 'claude-3-7-sonnet' });
    store.setReviewerSelections([]);
    expect(store.canSubmit()).toBe(false);
  });

  it('prevents duplicate provider/model reviewer combinations', () => {
    store.setReviewerSelections([{ provider: 'codex', model: 'gpt-4o' }]);
    const added = store.addReviewer({ provider: 'codex', model: 'gpt-4o' });

    expect(added).toBe(false);
    expect(store.reviewerSelections().length).toBe(1);
  });

  it('disables submission when an active job is already running', async () => {
    apiClientMock.request.mockImplementation((opts) => {
      if (opts.path === '/api/reviews/active') {
        return Promise.resolve(mockCreatedJob);
      }
      return Promise.resolve({});
    });

    await store.loadInitialData();
    expect(store.activeJob()).toBeTruthy();
    expect(store.canSubmit()).toBe(false);
  });

  it('creates review job successfully and prevents double submission', async () => {
    store.setPrUrl('https://dev.azure.com/acme/project/_git/repo/pullrequest/123');
    store.prSummary.set(mockPrSummary);
    store.setMainSelection({ provider: 'claude', model: 'claude-3-7-sonnet' });
    store.setReviewerSelections([{ provider: 'codex', model: 'gpt-4o' }]);

    apiClientMock.request.mockResolvedValueOnce(mockCreatedJob);

    const job = await store.createReview();
    expect(job).toEqual(mockCreatedJob);
    expect(apiClientMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/reviews',
        body: expect.objectContaining({
          pullRequestUrl: 'https://dev.azure.com/acme/project/_git/repo/pullrequest/123',
          main: { provider: 'claude', model: 'claude-3-7-sonnet' },
          reviewers: [{ provider: 'codex', model: 'gpt-4o' }],
        }),
      }),
    );
  });

  it('captures activeReviewConflictId when review creation encounters 409 conflict', async () => {
    store.setPrUrl('https://dev.azure.com/acme/project/_git/repo/pullrequest/123');
    store.prSummary.set(mockPrSummary);
    store.setMainSelection({ provider: 'claude', model: 'claude-3-7-sonnet' });
    store.setReviewerSelections([{ provider: 'codex', model: 'gpt-4o' }]);

    const conflictErr = new ApiError(409, 'CONFLICT', 'Another review is already active', undefined, {
      activeReviewId: 'active-job-xyz',
    });
    apiClientMock.request.mockRejectedValueOnce(conflictErr);

    await expect(store.createReview()).rejects.toThrow();
    expect(store.activeReviewConflictId()).toBe('active-job-xyz');
    expect(store.submitError()).toBe('Another review is already active');
  });
});
