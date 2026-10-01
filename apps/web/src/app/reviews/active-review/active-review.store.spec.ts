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

  describe('Live activity & Verifier integration', () => {
    it('does not regress current activity when an older snapshot entry is replayed', () => {
      const run = mockActiveJob.reviewers[0];
      const older = { id: `${run.id}:1`, runId: run.id, seq: 1, at: '2026-10-01T12:00:00.000Z', kind: 'provider' as const, action: 'thinking' as const };
      const newer = { ...older, id: `${run.id}:2`, seq: 2, at: '2026-10-01T12:00:10.000Z', action: 'writing_answer' as const };
      store.job.set({ ...mockActiveJob, reviewers: [{ ...run, activity: { visibility: 'full', recent: [older, newer], current: newer, lastActivityAt: newer.at, lastHeartbeatAt: null, total: 2 } }] });
      store.applyEvent({ reviewId: mockActiveJob.id, sequence: 10, emittedAt: newer.at, type: 'run.activity', payload: { runId: run.id, role: 'reviewer', activity: older, visibility: 'full', total: 1, lastActivityAt: older.at } });
      expect(store.job()?.reviewers[0].activity?.current).toEqual(newer);
      expect(store.job()?.reviewers[0].activity?.lastActivityAt).toBe(newer.at);
      expect(store.job()?.reviewers[0].activity?.recent).toEqual([older, newer]);
    });

    it('coalesces full log requests and allows reloading after a reconnect snapshot', async () => {
      store.job.set(mockActiveJob);
      apiClientMock.request.mockResolvedValue({ runId: mockActiveJob.reviewers[0].id, items: [], total: 0 });
      await store.loadRunActivity(mockActiveJob.reviewers[0].id);
      await store.loadRunActivity(mockActiveJob.reviewers[0].id);
      expect(apiClientMock.request).toHaveBeenCalledTimes(1);
      store.applyEvent({ reviewId: mockActiveJob.id, sequence: 10, emittedAt: '2026-10-01T12:00:00.000Z', type: 'job.snapshot', payload: { job: mockActiveJob } });
      await store.loadRunActivity(mockActiveJob.reviewers[0].id);
      expect(apiClientMock.request).toHaveBeenCalledTimes(2);
    });

    it('allows retrying failed full log requests', async () => {
      store.job.set(mockActiveJob);
      apiClientMock.request.mockRejectedValueOnce(new Error('offline'));
      await store.loadRunActivity(mockActiveJob.reviewers[0].id);
      apiClientMock.request.mockResolvedValueOnce({ runId: mockActiveJob.reviewers[0].id, items: [], total: 0 });
      await store.loadRunActivity(mockActiveJob.reviewers[0].id);
      expect(apiClientMock.request).toHaveBeenCalledTimes(2);
    });
    it('handles snapshot with activity, then run.activity (including a duplicate id): no duplicate rows', async () => {
      const jobWithActivity: ReviewJob = {
        ...mockActiveJob,
        reviewers: [
          {
            ...mockActiveJob.reviewers[0],
            activity: {
              visibility: 'full',
              recent: [
                {
                  id: 'rev-run-1:1',
                  runId: '123e4567-e89b-12d3-a456-426614174001',
                  seq: 1,
                  at: '2026-10-01T12:00:00.000Z',
                  kind: 'lifecycle',
                  action: 'attempt_started',
                  attempt: 1,
                },
                {
                  id: 'rev-run-1:2',
                  runId: '123e4567-e89b-12d3-a456-426614174001',
                  seq: 2,
                  at: '2026-10-01T12:00:05.000Z',
                  kind: 'provider',
                  action: 'reading_file',
                  target: { path: 'src/index.ts', startLine: 1, endLine: 20 },
                },
              ],
              current: {
                id: 'rev-run-1:2',
                runId: '123e4567-e89b-12d3-a456-426614174001',
                seq: 2,
                at: '2026-10-01T12:00:05.000Z',
                kind: 'provider',
                action: 'reading_file',
                target: { path: 'src/index.ts', startLine: 1, endLine: 20 },
              },
              lastActivityAt: '2026-10-01T12:00:05.000Z',
              lastHeartbeatAt: null,
              total: 2,
            },
          },
          mockActiveJob.reviewers[1],
        ],
      };

      apiClientMock.request.mockResolvedValueOnce(jobWithActivity);
      await store.loadJob();

      expect(store.job()?.reviewers[0].activity?.recent).toHaveLength(2);

      // 1. Emit duplicate entry (id: 'rev-run-1:2')
      eventsSubject.next({
        reviewId: mockActiveJob.id,
        sequence: 4,
        emittedAt: new Date().toISOString(),
        type: 'run.activity',
        payload: {
          runId: 'rev-run-1',
          role: 'reviewer',
          activity: {
            id: 'rev-run-1:2',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 2,
            at: '2026-10-01T12:00:05.000Z',
            kind: 'provider',
            action: 'reading_file',
            target: { path: 'src/index.ts', startLine: 1, endLine: 20 },
          },
          visibility: 'full',
          total: 2,
          lastActivityAt: '2026-10-01T12:00:05.000Z',
        },
      });

      // No duplicate rows added
      expect(store.job()?.reviewers[0].activity?.recent).toHaveLength(2);

      // 2. Emit new entry (id: 'rev-run-1:3')
      eventsSubject.next({
        reviewId: mockActiveJob.id,
        sequence: 5,
        emittedAt: new Date().toISOString(),
        type: 'run.activity',
        payload: {
          runId: 'rev-run-1',
          role: 'reviewer',
          activity: {
            id: 'rev-run-1:3',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 3,
            at: '2026-10-01T12:00:10.000Z',
            kind: 'provider',
            action: 'running_command',
          },
          visibility: 'full',
          total: 3,
          lastActivityAt: '2026-10-01T12:00:10.000Z',
        },
      });

      const updatedSummary = store.job()?.reviewers[0].activity;
      expect(updatedSummary?.recent).toHaveLength(3);
      expect(updatedSummary?.recent[2].id).toBe('rev-run-1:3');
      expect(updatedSummary?.current?.action).toBe('running_command');
      expect(updatedSummary?.lastActivityAt).toBe('2026-10-01T12:00:10.000Z');
      expect(updatedSummary?.total).toBe(3);
    });

    it('run.heartbeat updates only lastHeartbeatAt and never touches lastActivityAt or the log', async () => {
      const jobWithActivity: ReviewJob = {
        ...mockActiveJob,
        reviewers: [
          {
            ...mockActiveJob.reviewers[0],
            activity: {
              visibility: 'full',
              recent: [
                {
                  id: 'rev-run-1:1',
                  runId: '123e4567-e89b-12d3-a456-426614174001',
                  seq: 1,
                  at: '2026-10-01T12:00:00.000Z',
                  kind: 'lifecycle',
                  action: 'attempt_started',
                  attempt: 1,
                },
              ],
              current: null,
              lastActivityAt: '2026-10-01T12:00:00.000Z',
              lastHeartbeatAt: null,
              total: 1,
            },
          },
        ],
      };

      apiClientMock.request.mockResolvedValueOnce(jobWithActivity);
      await store.loadJob();

      const hbTime = '2026-10-01T12:00:15.000Z';
      eventsSubject.next({
        reviewId: mockActiveJob.id,
        sequence: 6,
        emittedAt: new Date().toISOString(),
        type: 'run.heartbeat',
        payload: {
          runId: 'rev-run-1',
          role: 'reviewer',
          at: hbTime,
        },
      });

      const act = store.job()?.reviewers[0].activity;
      expect(act?.lastHeartbeatAt).toBe(hbTime);
      expect(act?.lastActivityAt).toBe('2026-10-01T12:00:00.000Z');
      expect(act?.recent).toHaveLength(1);
    });

    it('a verifier reviewer.state_changed updates job.verifier and clears heartbeat on leaving running', async () => {
      const jobWithVerifier: ReviewJob = {
        ...mockActiveJob,
        verifier: {
          id: 'verifier-run-1',
          selection: { provider: 'claude', model: 'claude-3-7-sonnet' },
          state: 'running',
          startedAt: '2026-10-01T12:01:00.000Z',
          completedAt: null,
          warning: null,
          activity: {
            visibility: 'full',
            recent: [],
            current: null,
            lastActivityAt: '2026-10-01T12:01:05.000Z',
            lastHeartbeatAt: '2026-10-01T12:01:10.000Z',
            total: 1,
          },
        },
      };

      apiClientMock.request.mockResolvedValueOnce(jobWithVerifier);
      await store.loadJob();

      expect(store.job()?.verifier?.state).toBe('running');
      expect(store.job()?.verifier?.activity?.lastHeartbeatAt).toBe('2026-10-01T12:01:10.000Z');

      const completedAt = '2026-10-01T12:03:00.000Z';
      eventsSubject.next({
        reviewId: mockActiveJob.id,
        sequence: 7,
        emittedAt: new Date().toISOString(),
        type: 'reviewer.state_changed',
        payload: {
          runId: 'verifier-run-1',
          role: 'verifier',
          reviewer: { provider: 'claude', model: 'claude-3-7-sonnet' },
          state: 'completed',
          completedAt,
        },
      });

      const verifier = store.job()?.verifier;
      expect(verifier?.state).toBe('completed');
      expect(verifier?.completedAt).toBe(completedAt);
      // Cleared on leaving running state
      expect(verifier?.activity?.lastHeartbeatAt).toBeNull();
    });

    it('a reconnect snapshot replaces summaries', async () => {
      await store.loadJob();

      // Accumulate live event
      eventsSubject.next({
        reviewId: mockActiveJob.id,
        sequence: 1,
        emittedAt: new Date().toISOString(),
        type: 'run.activity',
        payload: {
          runId: 'rev-run-1',
          role: 'reviewer',
          activity: {
            id: 'rev-run-1:1',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 1,
            at: '2026-10-01T12:00:00.000Z',
            kind: 'provider',
            action: 'thinking',
          },
          visibility: 'full',
          total: 1,
          lastActivityAt: '2026-10-01T12:00:00.000Z',
        },
      });

      expect(store.job()?.reviewers[0].activity?.recent).toHaveLength(1);

      // Reconnect receives clean snapshot
      const freshJobSnapshot: ReviewJob = {
        ...mockActiveJob,
        reviewers: [
          {
            ...mockActiveJob.reviewers[0],
            activity: {
              visibility: 'partial',
              recent: [
                {
                  id: 'rev-run-1:10',
                  runId: '123e4567-e89b-12d3-a456-426614174001',
                  seq: 10,
                  at: '2026-10-01T12:10:00.000Z',
                  kind: 'provider',
                  action: 'searching',
                },
              ],
              current: null,
              lastActivityAt: '2026-10-01T12:10:00.000Z',
              lastHeartbeatAt: null,
              total: 10,
            },
          },
          mockActiveJob.reviewers[1],
        ],
      };

      eventsSubject.next({
        reviewId: mockActiveJob.id,
        sequence: 2,
        emittedAt: new Date().toISOString(),
        type: 'job.snapshot',
        payload: { job: freshJobSnapshot },
      });

      const replacedAct = store.job()?.reviewers[0].activity;
      expect(replacedAct?.visibility).toBe('partial');
      expect(replacedAct?.total).toBe(10);
      expect(replacedAct?.recent).toHaveLength(1);
      expect(replacedAct?.recent[0].id).toBe('rev-run-1:10');
    });

    it('legacy jobs without verifier/activity still render', async () => {
      const legacyJob: ReviewJob = {
        ...mockActiveJob,
        verifier: undefined,
        reviewers: [
          {
            id: 'legacy-1',
            selection: { provider: 'codex', model: 'gpt-4o' },
            state: 'completed',
            startedAt: '2026-09-01T10:00:00.000Z',
            completedAt: '2026-09-01T10:01:00.000Z',
            warning: null,
          },
        ],
      };

      apiClientMock.request.mockResolvedValueOnce(legacyJob);
      await store.loadJob();

      expect(store.job()).toBeTruthy();
      expect(store.job()?.verifier).toBeUndefined();
      expect(store.job()?.reviewers[0].activity).toBeUndefined();
    });

    it('fetches full activity log and merges items into store when loadRunActivity is called', async () => {
      const job: ReviewJob = {
        ...mockActiveJob,
        reviewers: [
          {
            ...mockActiveJob.reviewers[0],
            activity: {
              visibility: 'full',
              recent: [
                {
                  id: 'rev-run-1:3',
                  runId: '123e4567-e89b-12d3-a456-426614174001',
                  seq: 3,
                  at: '2026-10-01T12:00:30.000Z',
                  kind: 'provider',
                  action: 'thinking',
                },
              ],
              current: null,
              lastActivityAt: '2026-10-01T12:00:30.000Z',
              lastHeartbeatAt: null,
              total: 5,
            },
          },
        ],
      };

      apiClientMock.request.mockResolvedValueOnce(job);
      await store.loadJob();

      // Mock full activity log response
      apiClientMock.request.mockResolvedValueOnce({
        runId: '123e4567-e89b-12d3-a456-426614174001',
        items: [
          {
            id: 'rev-run-1:1',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 1,
            at: '2026-10-01T12:00:00.000Z',
            kind: 'lifecycle',
            action: 'attempt_started',
            attempt: 1,
          },
          {
            id: 'rev-run-1:2',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 2,
            at: '2026-10-01T12:00:10.000Z',
            kind: 'provider',
            action: 'reading_file',
            target: { path: 'src/main.ts' },
          },
          {
            id: 'rev-run-1:3',
            runId: '123e4567-e89b-12d3-a456-426614174001',
            seq: 3,
            at: '2026-10-01T12:00:30.000Z',
            kind: 'provider',
            action: 'thinking',
          },
        ],
        total: 5,
      });

      await store.loadRunActivity('rev-run-1');

      const act = store.job()?.reviewers[0].activity;
      expect(act?.recent).toHaveLength(3);
      expect(act?.recent[0].seq).toBe(1);
      expect(act?.recent[1].seq).toBe(2);
      expect(act?.recent[2].seq).toBe(3);
    });
  });

});
