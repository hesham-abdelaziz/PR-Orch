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

  it('handles HTTP 204 when no active review exists without connecting to SSE stream', async () => {
    apiClientMock.request.mockResolvedValueOnce(null);

    await store.loadJob();

    expect(store.job()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(eventsServiceMock.connect).not.toHaveBeenCalled();
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

  // Requirement Test 1: Job failed with warning "Failed during reviewing: All reviewers failed. …"
  it('calculates stages for job failed during reviewing: stages 1–4 completed, 5 failed, 6–7 not run, 8 completed', async () => {
    const failedJob: ReviewJob = {
      ...mockActiveJob,
      state: 'failed',
      warnings: [
        'Detected framework guidance used as fallback standards.',
        'Failed during reviewing: All reviewers failed. codex: exit code 1; gemini: exit code 41',
      ],
      reviewers: [
        { ...mockActiveJob.reviewers[0]!, state: 'failed', warning: 'codex rejected model' },
        { ...mockActiveJob.reviewers[1]!, state: 'failed', warning: 'gemini exited with 41' },
      ],
    };
    apiClientMock.request.mockResolvedValueOnce(failedJob);

    await store.loadJob();

    const stages = store.stageStatuses();
    expect(stages).toHaveLength(8);

    // stages 1–4 completed
    expect(stages[0].key).toBe('validate');
    expect(stages[0].status).toBe('completed');
    expect(stages[1].key).toBe('checkout');
    expect(stages[1].status).toBe('completed');
    expect(stages[2].key).toBe('detect');
    expect(stages[2].status).toBe('completed');
    expect(stages[3].key).toBe('standards');
    expect(stages[3].status).toBe('completed');

    // 5 failed
    expect(stages[4].key).toBe('reviewers');
    expect(stages[4].status).toBe('failed');

    // 6–7 not run
    expect(stages[5].key).toBe('verify');
    expect(stages[5].status).toBe('not_run');
    expect(stages[6].key).toBe('report');
    expect(stages[6].status).toBe('not_run');

    // 8 completed
    expect(stages[7].key).toBe('cleanup');
    expect(stages[7].status).toBe('completed');
  });

  // Requirement Test 2: Failed during verifying
  it('calculates stages for job failed during verifying: stages 1–5 completed, 6 failed, 7 not run, 8 completed', async () => {
    const failedJob: ReviewJob = {
      ...mockActiveJob,
      state: 'failed',
      warnings: [
        'Failed during verifying: Verifier model timed out after 300000 ms',
      ],
      reviewers: [
        { ...mockActiveJob.reviewers[0]!, state: 'completed' },
        { ...mockActiveJob.reviewers[1]!, state: 'completed' },
      ],
    };
    apiClientMock.request.mockResolvedValueOnce(failedJob);

    await store.loadJob();

    const stages = store.stageStatuses();
    expect(stages).toHaveLength(8);

    // stages 1–5 completed
    expect(stages[0].status).toBe('completed'); // validate
    expect(stages[1].status).toBe('completed'); // checkout
    expect(stages[2].status).toBe('completed'); // detect
    expect(stages[3].status).toBe('completed'); // standards
    expect(stages[4].status).toBe('completed'); // reviewers

    // 6 failed
    expect(stages[5].status).toBe('failed'); // verify

    // 7 not run
    expect(stages[6].status).toBe('not_run'); // report

    // 8 completed
    expect(stages[7].status).toBe('completed'); // cleanup
  });

  // Requirement Test 3: Older job without the warning: not all stages failed
  it('handles older job without the warning: not all stages failed', async () => {
    const olderJobAllReviewersFailed: ReviewJob = {
      ...mockActiveJob,
      state: 'failed',
      warnings: [],
      reviewers: [
        { ...mockActiveJob.reviewers[0]!, state: 'failed' },
        { ...mockActiveJob.reviewers[1]!, state: 'failed' },
      ],
    };
    apiClientMock.request.mockResolvedValueOnce(olderJobAllReviewersFailed);

    await store.loadJob();

    let stages = store.stageStatuses();
    // Must never mark all stages failed
    expect(stages.every((s) => s.status === 'failed')).toBe(false);
    expect(stages[0].status).toBe('completed');
    expect(stages[1].status).toBe('completed');
    expect(stages[2].status).toBe('completed');
    expect(stages[3].status).toBe('completed');
    expect(stages[4].status).toBe('failed');
    expect(stages[5].status).toBe('not_run');
    expect(stages[6].status).toBe('not_run');
    expect(stages[7].status).toBe('completed');

    // And if not all reviewers failed and no warning exists: shows unknown for unknown stages, cleanup completed, not all failed
    const olderJobUnknown: ReviewJob = {
      ...mockActiveJob,
      state: 'failed',
      warnings: [],
      reviewers: [
        { ...mockActiveJob.reviewers[0]!, state: 'completed' },
        { ...mockActiveJob.reviewers[1]!, state: 'running' },
      ],
    };
    apiClientMock.request.mockResolvedValueOnce(olderJobUnknown);
    await store.loadJob();

    stages = store.stageStatuses();
    expect(stages.every((s) => s.status === 'failed')).toBe(false);
    expect(stages[0].status).toBe('unknown');
    expect(stages[7].status).toBe('completed');
  });

  it('maps preparing failure with workspace layout to detect stage', async () => {
    const job: ReviewJob = {
      ...mockActiveJob,
      state: 'failed',
      warnings: ['Failed during preparing: The prepared workspace layout is invalid: no src directory'],
    };
    apiClientMock.request.mockResolvedValueOnce(job);
    await store.loadJob();

    const stages = store.stageStatuses();
    expect(stages[0].status).toBe('completed'); // validate
    expect(stages[1].status).toBe('completed'); // checkout
    expect(stages[2].status).toBe('failed');    // detect
    expect(stages[3].status).toBe('not_run');   // standards
    expect(stages[4].status).toBe('not_run');   // reviewers
    expect(stages[7].status).toBe('completed'); // cleanup
  });

  it('maps preparing failure with standards to standards stage', async () => {
    const job: ReviewJob = {
      ...mockActiveJob,
      state: 'failed',
      warnings: ['Failed during preparing: Invalid standards file format'],
    };
    apiClientMock.request.mockResolvedValueOnce(job);
    await store.loadJob();

    const stages = store.stageStatuses();
    expect(stages[0].status).toBe('completed'); // validate
    expect(stages[1].status).toBe('completed'); // checkout
    expect(stages[2].status).toBe('completed'); // detect
    expect(stages[3].status).toBe('failed');    // standards
    expect(stages[4].status).toBe('not_run');   // reviewers
    expect(stages[7].status).toBe('completed'); // cleanup
  });

  it('filters out failure warning from displayWarnings', async () => {
    const job: ReviewJob = {
      ...mockActiveJob,
      state: 'failed',
      warnings: [
        'Detected framework guidance used as fallback standards.',
        'Failed during reviewing: All reviewers failed.',
      ],
    };
    apiClientMock.request.mockResolvedValueOnce(job);
    await store.loadJob();

    expect(store.failureWarning()).toBe('Failed during reviewing: All reviewers failed.');
    expect(store.displayWarnings()).toEqual(['Detected framework guidance used as fallback standards.']);
    expect(store.warnings()).toEqual([
      'Detected framework guidance used as fallback standards.',
      'Failed during reviewing: All reviewers failed.',
    ]);
  });
});
