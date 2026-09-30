import { ReviewEventSchema, type ReviewEvent, type ReviewJob } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import { jobRecord, pullRequest, uuid } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';
import { ReviewEventsService } from './review-events.service.js';
import type { EventSequenceStore } from './review-repository.js';

const REVIEW_ID = '00000000-0000-4000-8000-00000000abcd';
const RUN_ID = '00000000-0000-4000-8000-00000000dcba';
const CODEX = { provider: 'codex', model: 'cli-default' } as const;

function snapshotJob(state: ReviewJob['state'] = 'reviewing'): ReviewJob {
  return {
    id: REVIEW_ID,
    state,
    pullRequest: pullRequest(),
    main: { provider: 'claude', model: 'opus' },
    reviewers: [
      {
        id: uuid(),
        selection: CODEX,
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

async function repositoryWithJob(): Promise<InMemoryReviewRepository> {
  const repository = new InMemoryReviewRepository();
  await repository.createJob(jobRecord({ id: REVIEW_ID }));

  return repository;
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
const sequencesOf = (events: readonly ReviewEvent[]) => events.map((event) => event.sequence);
const strictlyIncreasing = (values: readonly number[]) => values.every((value, index) => index === 0 || value > (values[index - 1] as number));

describe('ReviewEventsService', () => {
  it('sends the current snapshot first, then live events with increasing sequence', async () => {
    const service = new ReviewEventsService(await repositoryWithJob(), () => new Date('2026-09-29T10:00:00.000Z'));
    service.jobStateChanged(REVIEW_ID, 'preparing');
    await service.flush(REVIEW_ID);
    const { received } = collect(service, () => Promise.resolve(snapshotJob()));
    await tick();

    service.jobStateChanged(REVIEW_ID, 'reviewing');
    service.reviewerStateChanged(REVIEW_ID, RUN_ID, 'running', CODEX);
    service.warning(REVIEW_ID, 'reviewer_failed', 'Reviewer gemini/pro timed out.');
    await service.flush(REVIEW_ID);

    expect(received.map((event) => event.type)).toEqual([
      'job.snapshot',
      'job.state_changed',
      'reviewer.state_changed',
      'job.warning',
    ]);
    expect(sequencesOf(received)).toEqual([1, 2, 3, 4]);
    for (const event of received) expect(() => ReviewEventSchema.parse(event)).not.toThrow();
  });

  it('gives a client reconnecting during an active review a snapshot that does not regress', async () => {
    const service = new ReviewEventsService(await repositoryWithJob());
    const first = collect(service, () => Promise.resolve(snapshotJob('queued')));
    await tick();
    service.jobStateChanged(REVIEW_ID, 'preparing');
    service.jobStateChanged(REVIEW_ID, 'reviewing');
    await service.flush(REVIEW_ID);
    const lastSeen = first.received.at(-1)?.sequence ?? 0;
    first.subscription.unsubscribe();

    const second = collect(service, () => Promise.resolve(snapshotJob('reviewing')));
    await tick();
    service.reviewerStateChanged(REVIEW_ID, RUN_ID, 'completed', CODEX);
    await service.flush(REVIEW_ID);

    expect(second.received[0]).toMatchObject({ type: 'job.snapshot', sequence: lastSeen });
    expect(second.received[1]?.sequence).toBe(lastSeen + 1);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'gives a client reconnecting after a %s review the final sequence, not 0, and then closes',
    async (state) => {
      const service = new ReviewEventsService(await repositoryWithJob());
      const live = collect(service, () => Promise.resolve(snapshotJob('queued')));
      await tick();
      service.jobStateChanged(REVIEW_ID, 'preparing');
      service.jobStateChanged(REVIEW_ID, state === 'cancelled' ? 'cancelling' : 'reviewing');
      service.jobStateChanged(REVIEW_ID, state);
      await service.flush(REVIEW_ID);
      expect(live.isComplete()).toBe(true);
      const finalSequence = live.received.at(-1)?.sequence ?? -1;
      expect(finalSequence).toBe(3);

      const late = collect(service, () => Promise.resolve(snapshotJob(state)));
      await tick();

      expect(late.received).toHaveLength(1);
      expect(late.received[0]).toMatchObject({ type: 'job.snapshot', sequence: finalSequence });
      expect(late.isComplete()).toBe(true);
    },
  );

  it('delivers events that raced with the snapshot load after it, in order, and never drops them', async () => {
    const service = new ReviewEventsService(await repositoryWithJob());
    let release: (job: ReviewJob) => void = () => undefined;
    const loading = new Promise<ReviewJob>((resolve) => {
      release = resolve;
    });
    const { received } = collect(service, () => loading);
    await tick(); // the persisted sequence (0) has been read; the snapshot is still loading

    service.jobStateChanged(REVIEW_ID, 'preparing');
    await service.flush(REVIEW_ID);
    release(snapshotJob('preparing'));
    await tick();
    service.jobStateChanged(REVIEW_ID, 'reviewing');
    await service.flush(REVIEW_ID);

    expect(received.map((event) => [event.type, event.sequence])).toEqual([
      ['job.snapshot', 0],
      ['job.state_changed', 1],
      ['job.state_changed', 2],
    ]);
  });

  it('completes after a terminal event that races with the snapshot load, without duplicates', async () => {
    const service = new ReviewEventsService(await repositoryWithJob());
    service.jobStateChanged(REVIEW_ID, 'preparing');
    await service.flush(REVIEW_ID);
    let release: (job: ReviewJob) => void = () => undefined;
    const loading = new Promise<ReviewJob>((resolve) => {
      release = resolve;
    });
    const { received, isComplete } = collect(service, () => loading);
    await tick();

    service.jobStateChanged(REVIEW_ID, 'failed');
    await service.flush(REVIEW_ID);
    expect(isComplete()).toBe(false); // nothing is sent before the snapshot
    release(snapshotJob('failed'));
    await tick();

    expect(received.map((event) => [event.type, event.sequence])).toEqual([
      ['job.snapshot', 1],
      ['job.state_changed', 2],
    ]);
    expect(isComplete()).toBe(true);
    expect(service.trackedReviewCount()).toBe(0);
  });

  it('drops events already covered by the snapshot so no subscriber sees a sequence twice', async () => {
    const repository = await repositoryWithJob();
    // Simulates the window where an event was numbered but not yet delivered
    // when the subscriber read the persisted sequence.
    let gate: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      gate = resolve;
    });
    const store: EventSequenceStore = {
      allocateEventSequence: async (jobId) => {
        const sequence = await repository.allocateEventSequence(jobId);
        await held;

        return sequence;
      },
      getEventSequence: (jobId) => repository.getEventSequence(jobId),
    };
    const service = new ReviewEventsService(store);
    service.jobStateChanged(REVIEW_ID, 'preparing'); // allocated as 1, delivery held
    await tick();

    const { received } = collect(service, () => Promise.resolve(snapshotJob('preparing')));
    await tick();
    gate();
    await service.flush(REVIEW_ID);
    service.jobStateChanged(REVIEW_ID, 'reviewing');
    await service.flush(REVIEW_ID);

    expect(received.map((event) => [event.type, event.sequence])).toEqual([
      ['job.snapshot', 1],
      ['job.state_changed', 2],
    ]);
    expect(strictlyIncreasing(sequencesOf(received))).toBe(true);
  });

  it('continues from the persisted sequence after a service restart', async () => {
    const repository = await repositoryWithJob();
    const before = new ReviewEventsService(repository);
    before.jobStateChanged(REVIEW_ID, 'preparing');
    before.jobStateChanged(REVIEW_ID, 'reviewing');
    before.reviewerStateChanged(REVIEW_ID, RUN_ID, 'running', CODEX);
    await before.flush(REVIEW_ID);

    const after = new ReviewEventsService(repository); // fresh process, same database
    const { received } = collect(after, () => Promise.resolve(snapshotJob('reviewing')));
    await tick();
    after.jobStateChanged(REVIEW_ID, 'failed');
    await after.flush(REVIEW_ID);

    expect(received.map((event) => [event.type, event.sequence])).toEqual([
      ['job.snapshot', 3],
      ['job.state_changed', 4],
    ]);
    expect(await repository.getEventSequence(REVIEW_ID)).toBe(4);
  });

  it('completes the stream cleanly after a terminal state event and releases bookkeeping', async () => {
    const service = new ReviewEventsService(await repositoryWithJob());
    const { received, isComplete } = collect(service, () => Promise.resolve(snapshotJob()));
    await tick();

    service.jobStateChanged(REVIEW_ID, 'verifying');
    await service.flush(REVIEW_ID);
    expect(isComplete()).toBe(false);
    expect(service.trackedReviewCount()).toBe(1);
    service.jobStateChanged(REVIEW_ID, 'cancelled');
    await service.flush(REVIEW_ID);
    await tick();

    expect(received.at(-1)).toMatchObject({ type: 'job.state_changed', payload: { state: 'cancelled' } });
    expect(isComplete()).toBe(true);
    expect(service.listenerCount(REVIEW_ID)).toBe(0);
    expect(service.trackedReviewCount()).toBe(0);
  });

  it('keeps no per-review state for reviews nobody watches once their events are delivered', async () => {
    const service = new ReviewEventsService(await repositoryWithJob());
    for (let index = 0; index < 50; index += 1) service.warning(REVIEW_ID, 'reviewer_partial', `warning ${index}`);
    await service.flush(REVIEW_ID);
    await tick();

    expect(service.trackedReviewCount()).toBe(0);
  });

  it('completes immediately for an unknown review', async () => {
    const service = new ReviewEventsService(new InMemoryReviewRepository());
    const { received, isComplete } = collect(service, () => Promise.resolve(snapshotJob()));
    await tick();

    expect(received).toEqual([]);
    expect(isComplete()).toBe(true);
    expect(service.trackedReviewCount()).toBe(0);
  });

  it('skips an event whose sequence cannot be persisted instead of guessing a number', async () => {
    const repository = await repositoryWithJob();
    let failNext = true;
    const store: EventSequenceStore = {
      allocateEventSequence: (jobId) => {
        if (failNext) {
          failNext = false;

          return Promise.reject(new Error('SQLITE_BUSY'));
        }

        return repository.allocateEventSequence(jobId);
      },
      getEventSequence: (jobId) => repository.getEventSequence(jobId),
    };
    const service = new ReviewEventsService(store);
    const { received } = collect(service, () => Promise.resolve(snapshotJob()));
    await tick();

    service.warning(REVIEW_ID, 'reviewer_partial', 'lost');
    service.warning(REVIEW_ID, 'reviewer_partial', 'kept');
    await service.flush(REVIEW_ID);

    expect(received.map((event) => [event.type, event.sequence])).toEqual([
      ['job.snapshot', 0],
      ['job.warning', 1],
    ]);
  });

  it('serves independent subscribers and stops delivering after unsubscribe', async () => {
    const service = new ReviewEventsService(await repositoryWithJob());
    const first = collect(service, () => Promise.resolve(snapshotJob()));
    const second = collect(service, () => Promise.resolve(snapshotJob()));
    await tick();
    expect(service.listenerCount(REVIEW_ID)).toBe(2);

    first.subscription.unsubscribe();
    service.jobStateChanged(REVIEW_ID, 'verifying');
    await service.flush(REVIEW_ID);

    expect(first.received.map((event) => event.type)).toEqual(['job.snapshot']);
    expect(second.received.map((event) => event.type)).toEqual(['job.snapshot', 'job.state_changed']);
    expect(service.listenerCount(REVIEW_ID)).toBe(1);
    second.subscription.unsubscribe();
    expect(service.trackedReviewCount()).toBe(0);
  });
});
