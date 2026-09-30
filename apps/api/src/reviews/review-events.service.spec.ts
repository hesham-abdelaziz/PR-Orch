import { ReviewEventSchema, type ReviewEvent, type ReviewJob } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import { pullRequest, uuid } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { ReviewEventsService } from './review-events.service.js';

const REVIEW_ID = '00000000-0000-4000-8000-00000000abcd';
const RUN_ID = '00000000-0000-4000-8000-00000000dcba';

function snapshotJob(state: ReviewJob['state'] = 'reviewing'): ReviewJob {
  return {
    id: REVIEW_ID,
    state,
    pullRequest: pullRequest(),
    main: { provider: 'claude', model: 'opus' },
    reviewers: [
      {
        id: uuid(),
        selection: { provider: 'codex', model: 'cli-default' },
        state: 'running',
        startedAt: '2026-09-29T10:00:00.000Z',
        completedAt: null,
        warning: null,
      },
    ],
    standards: null,
    warnings: [],
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    completedAt: null,
  };
}

function collect(service: ReviewEventsService, load: () => Promise<ReviewJob | null>) {
  const received: ReviewEvent[] = [];
  let completed = false;
  const subscription = service.stream(REVIEW_ID, load).subscribe({
    next: (event) => received.push(event),
    complete: () => {
      completed = true;
    },
  });

  return { received, isComplete: () => completed, subscription };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('ReviewEventsService', () => {
  it('sends the current snapshot first, then live events with increasing sequence', async () => {
    const service = new ReviewEventsService(() => new Date('2026-09-29T10:00:00.000Z'));
    service.jobStateChanged(REVIEW_ID, 'preparing');
    const { received } = collect(service, () => Promise.resolve(snapshotJob()));
    await tick();

    service.jobStateChanged(REVIEW_ID, 'reviewing');
    service.reviewerStateChanged(REVIEW_ID, RUN_ID, 'running', { provider: 'codex', model: 'cli-default' });
    service.warning(REVIEW_ID, 'reviewer_failed', 'Reviewer gemini/pro timed out.');

    expect(received.map((event) => event.type)).toEqual([
      'job.snapshot',
      'job.state_changed',
      'reviewer.state_changed',
      'job.warning',
    ]);
    const sequences = received.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(new Set(sequences.slice(1)).size).toBe(3);
    expect(sequences[1]).toBeGreaterThan(sequences[0] ?? 0);
    for (const event of received) expect(() => ReviewEventSchema.parse(event)).not.toThrow();
  });

  it('delivers events that raced with the snapshot load after it, in order, and never drops them', async () => {
    const service = new ReviewEventsService();
    let release: (job: ReviewJob) => void = () => undefined;
    const loading = new Promise<ReviewJob>((resolve) => {
      release = resolve;
    });
    const { received } = collect(service, () => loading);

    service.jobStateChanged(REVIEW_ID, 'preparing'); // emitted while the snapshot is still loading
    release(snapshotJob('preparing'));
    await tick();
    service.jobStateChanged(REVIEW_ID, 'reviewing');

    expect(received.map((event) => event.type)).toEqual([
      'job.snapshot',
      'job.state_changed',
      'job.state_changed',
    ]);
    expect(received.slice(1).map((event) => (event.payload as { state: string }).state)).toEqual([
      'preparing',
      'reviewing',
    ]);
    const sequences = received.map((event) => event.sequence);
    expect(sequences[1]).toBeGreaterThan(sequences[0] ?? Number.MAX_SAFE_INTEGER);
    expect(sequences[2]).toBeGreaterThan(sequences[1] ?? Number.MAX_SAFE_INTEGER);
  });

  it('completes the stream cleanly after a terminal state event', async () => {
    const service = new ReviewEventsService();
    const { received, isComplete } = collect(service, () => Promise.resolve(snapshotJob()));
    await tick();

    service.jobStateChanged(REVIEW_ID, 'verifying');
    expect(isComplete()).toBe(false);
    service.jobStateChanged(REVIEW_ID, 'cancelled');

    expect(received.at(-1)).toMatchObject({ type: 'job.state_changed', payload: { state: 'cancelled' } });
    expect(isComplete()).toBe(true);
    expect(service.listenerCount(REVIEW_ID)).toBe(0);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'gives late subscribers of a %s job the snapshot and then closes',
    async (state) => {
      const service = new ReviewEventsService();
      const { received, isComplete } = collect(service, () => Promise.resolve(snapshotJob(state)));
      await tick();

      expect(received.map((event) => event.type)).toEqual(['job.snapshot']);
      expect(isComplete()).toBe(true);
    },
  );

  it('completes immediately for an unknown review', async () => {
    const service = new ReviewEventsService();
    const { received, isComplete } = collect(service, () => Promise.resolve(null));
    await tick();

    expect(received).toEqual([]);
    expect(isComplete()).toBe(true);
  });

  it('serves independent subscribers and stops delivering after unsubscribe', async () => {
    const service = new ReviewEventsService();
    const first = collect(service, () => Promise.resolve(snapshotJob()));
    const second = collect(service, () => Promise.resolve(snapshotJob()));
    await tick();
    expect(service.listenerCount(REVIEW_ID)).toBe(2);

    first.subscription.unsubscribe();
    service.jobStateChanged(REVIEW_ID, 'verifying');

    expect(first.received.map((event) => event.type)).toEqual(['job.snapshot']);
    expect(second.received.map((event) => event.type)).toEqual(['job.snapshot', 'job.state_changed']);
    expect(service.listenerCount(REVIEW_ID)).toBe(1);
  });
});
