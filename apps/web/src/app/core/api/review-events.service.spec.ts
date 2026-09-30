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
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
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
  });

  it('connects to event source endpoint and receives events monotonically', async () => {
    const receivedEvents: ReviewEvent[] = [];
    service.connect(reviewId).subscribe((evt: ReviewEvent) => {
      receivedEvents.push(evt);
    });

    await new Promise((r) => setTimeout(r, 10));
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

  it('ignores duplicate and out-of-order sequence events', async () => {
    const receivedEvents: ReviewEvent[] = [];
    service.connect(reviewId).subscribe((evt: ReviewEvent) => {
      receivedEvents.push(evt);
    });

    await new Promise((r) => setTimeout(r, 10));
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

  it('rejects malformed events without crashing stream', async () => {
    const receivedEvents: ReviewEvent[] = [];
    service.connect(reviewId).subscribe((evt: ReviewEvent) => {
      receivedEvents.push(evt);
    });

    await new Promise((r) => setTimeout(r, 10));
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

  it('closes EventSource when terminal state is reached', async () => {
    service.connect(reviewId).subscribe();
    await new Promise((r) => setTimeout(r, 10));
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
});
