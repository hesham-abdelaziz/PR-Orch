import { TestBed } from '@angular/core/testing';
import { ActiveReviewStore } from './active-review.store';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReviewEventsService } from '../../core/api/review-events.service';
import { ReviewJob } from '@pr-orchestrator/contracts';
import { of, Subject } from 'rxjs';

describe('ActiveReviewStore', () => {
  let store: ActiveReviewStore;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };
  let eventsServiceMock: {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
  let eventsSubject: Subject<any>;

  const mockActiveJob: ReviewJob = {
    id: '123e4567-e89b-12d3-a456-426614174099',
    state: 'reviewing',
    pullRequest: {
      url: 'https://dev.azure.com/acme/proj/_git/repo/pullrequest/100',
      organization: 'acme',
      project: 'proj',
      repository: 'repo',
      pullRequestId: 100,
      title: 'Fix memory leak',
      author: { id: 'u1', displayName: 'Dev 1' },
      sourceBranch: 'fix/leak',
      targetBranch: 'main',
      sourceCommit: 'abcdef1234567',
      targetCommit: '7654321fedcba',
      changedFiles: 3,
      additions: 40,
      deletions: 10,
      updatedAt: new Date().toISOString(),
    },
    main: { provider: 'claude', model: 'claude-3-7-sonnet' },
    reviewers: [
      {
        id: 'rev-run-1',
        selection: { provider: 'codex', model: 'gpt-4o' },
        state: 'running',
        startedAt: new Date().toISOString(),
        completedAt: null,
        warning: null,
      },
      {
        id: 'rev-run-2',
        selection: { provider: 'gemini', model: 'gemini-1.5-pro' },
        state: 'running',
        startedAt: new Date().toISOString(),
        completedAt: null,
        warning: null,
      },
    ],
    standards: null,
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  beforeEach(() => {
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

    TestBed.configureTestingModule({
      providers: [
        ActiveReviewStore,
        { provide: ApiClientService, useValue: apiClientMock },
        { provide: ReviewEventsService, useValue: eventsServiceMock },
      ],
    });

    store = TestBed.inject(ActiveReviewStore);
  });

  afterEach(() => {
    store.disconnect();
  });

  it('loads active job and connects to SSE stream', async () => {
    await store.loadJob();

    expect(store.job()).toEqual(mockActiveJob);
    expect(eventsServiceMock.connect).toHaveBeenCalledWith(mockActiveJob.id);
    expect(store.canCancel()).toBe(true);
    expect(store.isTerminal()).toBe(false);
  });

  it('updates reviewer state upon receiving reviewer.state_changed event', async () => {
    await store.loadJob();

    eventsSubject.next({
      reviewId: mockActiveJob.id,
      sequence: 1,
      emittedAt: new Date().toISOString(),
      type: 'reviewer.state_changed',
      payload: {
        runId: 'rev-run-1',
        state: 'completed',
        reviewer: { provider: 'codex', model: 'gpt-4o' },
      },
    });

    const rev1 = store.job()?.reviewers.find((r: { id: string }) => r.id === 'rev-run-1');
    expect(rev1?.state).toBe('completed');
  });

  it('handles partial reviewer failure and marks hasPartialReviewerFailure', async () => {
    await store.loadJob();

    // Rev 1 completes
    eventsSubject.next({
      reviewId: mockActiveJob.id,
      sequence: 1,
      emittedAt: new Date().toISOString(),
      type: 'reviewer.state_changed',
      payload: {
        runId: 'rev-run-1',
        state: 'completed',
        reviewer: { provider: 'codex', model: 'gpt-4o' },
      },
    });

    // Rev 2 times out
    eventsSubject.next({
      reviewId: mockActiveJob.id,
      sequence: 2,
      emittedAt: new Date().toISOString(),
      type: 'reviewer.state_changed',
      payload: {
        runId: 'rev-run-2',
        state: 'timed_out',
        reviewer: { provider: 'gemini', model: 'gemini-1.5-pro' },
      },
    });

    expect(store.hasPartialReviewerFailure()).toBe(true);
    expect(store.allReviewersFailed()).toBe(false);
  });

  it('detects all-reviewer failure when every reviewer fails', async () => {
    await store.loadJob();

    eventsSubject.next({
      reviewId: mockActiveJob.id,
      sequence: 1,
      emittedAt: new Date().toISOString(),
      type: 'reviewer.state_changed',
      payload: { runId: 'rev-run-1', state: 'failed', reviewer: { provider: 'codex', model: 'gpt-4o' } },
    });
    eventsSubject.next({
      reviewId: mockActiveJob.id,
      sequence: 2,
      emittedAt: new Date().toISOString(),
      type: 'reviewer.state_changed',
      payload: { runId: 'rev-run-2', state: 'failed', reviewer: { provider: 'gemini', model: 'gemini-1.5-pro' } },
    });

    expect(store.allReviewersFailed()).toBe(true);
  });

  it('cancels review job and tracks cancelling state', async () => {
    await store.loadJob();
    await store.cancelReview();

    expect(apiClientMock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: `/api/reviews/${mockActiveJob.id}/cancel`,
      }),
    );
    expect(store.cancelling()).toBe(true);

    // Event arrives with cancelled state
    eventsSubject.next({
      reviewId: mockActiveJob.id,
      sequence: 3,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'cancelled' },
    });

    expect(store.job()?.state).toBe('cancelled');
    expect(store.isTerminal()).toBe(true);
    expect(store.canCancel()).toBe(false);
  });
});
