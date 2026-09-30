import { TestBed } from '@angular/core/testing';
import { ReviewEventsService } from './review-events.service';
import { ApiClientService } from './api-client.service';
import { AuthStore } from '../auth/auth.store';
import { ReviewEvent } from '@pr-orchestrator/contracts';

// Mock EventSource globally for testing
class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((error: any) => void) | null = null;
  onopen: (() => void) | null = null;
  readyState = 0; // CONNECTING
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 0);
  }

  close = vi.fn(() => {
    this.readyState = 2; // CLOSED
  });

  emitMessage(data: any): void {
    if (this.onmessage) {
      this.onmessage(
        new MessageEvent('message', {
          data: JSON.stringify(data),
          lastEventId: typeof data.sequence === 'number' ? String(data.sequence) : '',
        }),
      );
    }
  }

  emitRawMessage(raw: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: raw }));
    }
  }

  emitError(err: any): void {
    if (this.onerror) {
      this.onerror(err);
    }
  }
}

describe('ReviewEventsService', () => {
  let service: ReviewEventsService;
  let apiClientMock: {
    request: ReturnType<typeof vi.fn>;
  };
  let authStoreMock: {
    checkSession: ReturnType<typeof vi.fn>;
  };

  const reviewId = '123e4567-e89b-12d3-a456-426614174099';

  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    (globalThis as any).EventSource = MockEventSource;

    apiClientMock = {
      request: vi.fn(),
    };
    authStoreMock = {
      checkSession: vi.fn().mockResolvedValue(true),
    };

    TestBed.configureTestingModule({
      providers: [
        ReviewEventsService,
        { provide: ApiClientService, useValue: apiClientMock },
        { provide: AuthStore, useValue: authStoreMock },
      ],
    });

    service = TestBed.inject(ReviewEventsService);
  });

  afterEach(() => {
    service.disconnect();
    vi.useRealTimers();
  });

  it('connects to event source endpoint and receives events monotonically', async () => {
    const receivedEvents: ReviewEvent[] = [];
    service.connect(reviewId).subscribe((evt: ReviewEvent) => {
      receivedEvents.push(evt);
    });

    vi.advanceTimersByTime(10);
    const es = MockEventSource.instances[0];
    expect(es).toBeTruthy();
    expect(es.url).toContain(`/api/reviews/${reviewId}/events`);

    // Emit event 0
    es.emitMessage({
      reviewId,
      sequence: 0,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'reviewing' },
    });

    // Emit event 1
    es.emitMessage({
      reviewId,
      sequence: 1,
      emittedAt: new Date().toISOString(),
      type: 'job.warning',
      payload: { code: 'SLOW_EXEC', message: 'Reviewer is taking longer than expected' },
    });

    expect(receivedEvents.length).toBe(2);
    expect(receivedEvents[0].sequence).toBe(0);
    expect(receivedEvents[1].sequence).toBe(1);
  });

  it('handles unnamed SSE messages containing ReviewEvent with sequence as message ID', async () => {
    const receivedEvents: ReviewEvent[] = [];
    service.connect(reviewId).subscribe((evt: ReviewEvent) => {
      receivedEvents.push(evt);
    });

    vi.advanceTimersByTime(10);
    const es = MockEventSource.instances[0];

    const unnamedEvent = {
      reviewId,
      sequence: 0,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'preparing' },
    };

    // Unnamed SSE message where event type is default 'message' and ID is sequence
    es.onmessage!(
      new MessageEvent('message', {
        data: JSON.stringify(unnamedEvent),
        lastEventId: '0',
      }),
    );

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].sequence).toBe(0);
    expect(receivedEvents[0].type).toBe('job.state_changed');
  });

  it('ignores duplicate and out-of-order sequence events without weakening sequence checks', async () => {
    const receivedEvents: ReviewEvent[] = [];
    service.connect(reviewId).subscribe((evt: ReviewEvent) => {
      receivedEvents.push(evt);
    });

    vi.advanceTimersByTime(10);
    const es = MockEventSource.instances[0];

    es.emitMessage({
      reviewId,
      sequence: 3,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'reviewing' },
    });

    // Duplicate sequence 3 should be ignored
    es.emitMessage({
      reviewId,
      sequence: 3,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'reviewing' },
    });

    // Lower sequence 2 should be rejected as monotonic regression
    es.emitMessage({
      reviewId,
      sequence: 2,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'preparing' },
    });

    // Sequence 4 accepted
    es.emitMessage({
      reviewId,
      sequence: 4,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'verifying' },
    });

    expect(receivedEvents.length).toBe(2);
    expect(receivedEvents[0].sequence).toBe(3);
    expect(receivedEvents[1].sequence).toBe(4);
  });

  it('reconnects after disconnect with backoff and ignores duplicate events received across reconnect', async () => {
    const receivedEvents: ReviewEvent[] = [];
    service.connect(reviewId).subscribe((evt: ReviewEvent) => {
      receivedEvents.push(evt);
    });

    vi.advanceTimersByTime(10);
    expect(MockEventSource.instances.length).toBe(1);
    const es1 = MockEventSource.instances[0];

    // Receive initial event sequence 0
    es1.emitMessage({
      reviewId,
      sequence: 0,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'preparing' },
    });

    expect(receivedEvents.length).toBe(1);

    // Trigger disconnect/error
    es1.emitError(new Error('Network drop'));
    expect(es1.close).toHaveBeenCalled();

    // Advance time for reconnect backoff (1s)
    vi.advanceTimersByTime(1100);
    expect(MockEventSource.instances.length).toBe(2);
    const es2 = MockEventSource.instances[1];

    // Reconnected stream resends duplicate sequence 0, then new sequence 1
    es2.emitMessage({
      reviewId,
      sequence: 0,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'preparing' },
    });

    es2.emitMessage({
      reviewId,
      sequence: 1,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'reviewing' },
    });

    // Sequence 0 should not be duplicated; sequence 1 should be received
    expect(receivedEvents.length).toBe(2);
    expect(receivedEvents[0].sequence).toBe(0);
    expect(receivedEvents[1].sequence).toBe(1);
  });

  it('rejects malformed events without crashing stream', async () => {
    const receivedEvents: ReviewEvent[] = [];
    service.connect(reviewId).subscribe((evt: ReviewEvent) => {
      receivedEvents.push(evt);
    });

    vi.advanceTimersByTime(10);
    const es = MockEventSource.instances[0];

    // Invalid JSON
    es.emitRawMessage('not a json');

    // Invalid schema (missing payload)
    es.emitMessage({
      reviewId,
      sequence: 0,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
    });

    // Valid event
    es.emitMessage({
      reviewId,
      sequence: 1,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'completed' },
    });

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].sequence).toBe(1);
  });

  it('closes EventSource when terminal state_changed event is reached', async () => {
    service.connect(reviewId).subscribe();
    vi.advanceTimersByTime(10);
    const es = MockEventSource.instances[0];

    es.emitMessage({
      reviewId,
      sequence: 5,
      emittedAt: new Date().toISOString(),
      type: 'job.state_changed',
      payload: { state: 'completed' },
    });

    expect(es.close).toHaveBeenCalled();
  });

  it('closes EventSource when terminal job.snapshot event is received', async () => {
    service.connect(reviewId).subscribe();
    vi.advanceTimersByTime(10);
    const es = MockEventSource.instances[0];

    const terminalSnapshotJob = {
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
      ],
      standards: null,
      warnings: [],
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T10:00:45.000Z',
      completedAt: '2026-09-30T10:00:45.000Z',
    };

    es.emitMessage({
      reviewId,
      sequence: 0,
      emittedAt: new Date().toISOString(),
      type: 'job.snapshot',
      payload: { job: terminalSnapshotJob },
    });

    expect(es.close).toHaveBeenCalled();
  });
});
