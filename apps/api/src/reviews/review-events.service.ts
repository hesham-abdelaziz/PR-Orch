import { Injectable } from '@nestjs/common';
import type {
  JobState,
  ModelSelection,
  ReviewEvent,
  ReviewJob,
  RunState,
} from '@pr-orchestrator/contracts';
import { Observable } from 'rxjs';

import { isTerminal } from './job-state-machine.js';

interface Listener {
  deliver(event: ReviewEvent): void;
  complete(): void;
}

type EventBody = Pick<ReviewEvent, 'type' | 'payload'>;

/**
 * Emits typed, monotonically sequenced review events. A new subscriber first
 * receives a snapshot of the persisted job and then live events, so a
 * reconnecting client never has to infer state from missed deltas.
 */
@Injectable()
export class ReviewEventsService {
  private readonly sequences = new Map<string, number>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  jobStateChanged(reviewId: string, state: JobState): void {
    this.emit(reviewId, { type: 'job.state_changed', payload: { state } });

    if (isTerminal(state)) {
      for (const listener of Array.from(this.listeners.get(reviewId) ?? [])) listener.complete();
      this.listeners.delete(reviewId);
      // Bounded memory: a late subscriber to a finished review only needs the snapshot.
      this.sequences.delete(reviewId);
    }
  }

  reviewerStateChanged(
    reviewId: string,
    runId: string,
    state: RunState,
    reviewer: ModelSelection,
  ): void {
    this.emit(reviewId, { type: 'reviewer.state_changed', payload: { runId, state, reviewer } });
  }

  warning(reviewId: string, code: string, message: string): void {
    this.emit(reviewId, { type: 'job.warning', payload: { code, message } });
  }

  listenerCount(reviewId: string): number {
    return this.listeners.get(reviewId)?.size ?? 0;
  }

  currentSequence(reviewId: string): number {
    return this.sequences.get(reviewId) ?? 0;
  }

  /** Snapshot first, then live events; completes once the job is terminal. */
  stream(reviewId: string, loadSnapshot: () => Promise<ReviewJob | null>): Observable<ReviewEvent> {
    return new Observable<ReviewEvent>((subscriber) => {
      let snapshotSent = false;
      let completeRequested = false;
      let closed = false;
      const buffered: ReviewEvent[] = [];

      const listener: Listener = {
        deliver: (event) => {
          if (snapshotSent) subscriber.next(event);
          else buffered.push(event);
        },
        complete: () => {
          if (snapshotSent) subscriber.complete();
          else completeRequested = true;
        },
      };
      const remove = () => {
        const set = this.listeners.get(reviewId);
        set?.delete(listener);
        if (set?.size === 0) this.listeners.delete(reviewId);
      };

      const set = this.listeners.get(reviewId) ?? new Set<Listener>();
      set.add(listener);
      this.listeners.set(reviewId, set);

      // Read before loading: an event that races with the load is delivered
      // after the snapshot (possibly redundantly) instead of being lost.
      const sequenceAtSubscription = this.currentSequence(reviewId);

      loadSnapshot().then(
        (job) => {
          if (closed) return;
          if (!job) {
            remove();
            subscriber.complete();

            return;
          }

          subscriber.next({
            reviewId,
            sequence: sequenceAtSubscription,
            emittedAt: this.clock().toISOString(),
            type: 'job.snapshot',
            payload: { job },
          });
          snapshotSent = true;
          for (const event of buffered.splice(0)) subscriber.next(event);

          if (isTerminal(job.state) || completeRequested) {
            remove();
            subscriber.complete();
          }
        },
        (error: unknown) => {
          remove();
          subscriber.error(error);
        },
      );

      return () => {
        closed = true;
        remove();
      };
    });
  }

  private emit(reviewId: string, body: EventBody): void {
    const sequence = this.currentSequence(reviewId) + 1;
    this.sequences.set(reviewId, sequence);

    const event = {
      reviewId,
      sequence,
      emittedAt: this.clock().toISOString(),
      ...body,
    } as ReviewEvent;

    for (const listener of Array.from(this.listeners.get(reviewId) ?? [])) listener.deliver(event);
  }
}
