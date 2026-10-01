import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  JobState,
  ModelSelection,
  ReviewEvent,
  ReviewJob,
  RunRole,
  RunState,
} from '@pr-orchestrator/contracts';
import { Observable } from 'rxjs';

import { isTerminal } from './job-state-machine.js';
import { REVIEW_REPOSITORY, type EventSequenceStore } from './review-repository.js';

export const REVIEW_EVENTS_CLOCK = Symbol('REVIEW_EVENTS_CLOCK');

interface Listener {
  deliver(event: ReviewEvent): void;
  complete(): void;
}

type EventBody = Pick<ReviewEvent, 'type' | 'payload'>;

/**
 * Emits typed review events whose sequence numbers come from the persisted
 * per-job counter (`EventSequenceStore`), so they never regress: not across
 * reconnects, not after the job finished, and not across a service restart.
 *
 * Ordering contract with the orchestrator: every event is emitted only after
 * the state change it announces has been persisted. A subscriber therefore
 * reads the persisted sequence S *before* loading the snapshot: every event
 * numbered <= S is already reflected in the snapshot and is dropped, and every
 * event numbered > S is delivered after it (possibly redundantly, never lost).
 *
 * Memory is bounded: per-review state exists only while a review has
 * subscribers or events waiting to be numbered, and is released afterwards.
 */
@Injectable()
export class ReviewEventsService {
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Per-review promise chain that numbers and delivers events in emission order. */
  private readonly queues = new Map<string, Promise<void>>();
  private readonly clock: () => Date;

  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly sequences: EventSequenceStore,
    @Optional() @Inject(REVIEW_EVENTS_CLOCK) clock?: () => Date,
  ) {
    this.clock = clock ?? (() => new Date());
  }

  jobStateChanged(reviewId: string, state: JobState): void {
    this.emit(reviewId, { type: 'job.state_changed', payload: { state } }, isTerminal(state));
  }

  /**
   * Run state change for a reviewer or (role `verifier`) the main verifier.
   * `details` carries the role plus the run's start and completion, so clients
   * can show elapsed time without a new snapshot.
   */
  reviewerStateChanged(
    reviewId: string,
    runId: string,
    state: RunState,
    reviewer: ModelSelection,
    details: { role?: RunRole; startedAt?: string | null; completedAt?: string | null } = {},
  ): void {
    this.emit(
      reviewId,
      { type: 'reviewer.state_changed', payload: { runId, state, reviewer, role: details.role ?? 'reviewer', ...times(details) } },
      false,
    );
  }

  runActivity(reviewId: string, payload: Extract<ReviewEvent, { type: 'run.activity' }>['payload']): void {
    this.emit(reviewId, { type: 'run.activity', payload }, false);
  }

  /** Liveness only; carries no activity and is never persisted. */
  runHeartbeat(reviewId: string, runId: string, role: RunRole, at: string): void {
    this.emit(reviewId, { type: 'run.heartbeat', payload: { runId, role, at } }, false);
  }

  warning(reviewId: string, code: string, message: string): void {
    this.emit(reviewId, { type: 'job.warning', payload: { code, message } }, false);
  }

  /** Resolves once every event emitted so far for the review has been numbered and delivered. */
  async flush(reviewId: string): Promise<void> {
    await this.queues.get(reviewId);
  }

  listenerCount(reviewId: string): number {
    return this.listeners.get(reviewId)?.size ?? 0;
  }

  /** Reviews that still hold in-memory bookkeeping (listeners or queued events). */
  trackedReviewCount(): number {
    return new Set([...this.listeners.keys(), ...this.queues.keys()]).size;
  }

  /** Snapshot first, then live events; completes once the job is terminal. */
  stream(reviewId: string, loadSnapshot: () => Promise<ReviewJob | null>): Observable<ReviewEvent> {
    return new Observable<ReviewEvent>((subscriber) => {
      let lastSent: number | null = null;
      let completeRequested = false;
      let closed = false;
      const buffered: ReviewEvent[] = [];

      const remove = () => {
        const set = this.listeners.get(reviewId);
        set?.delete(listener);
        if (set?.size === 0) this.listeners.delete(reviewId);
      };
      const send = (event: ReviewEvent) => {
        // Never deliver a sequence twice or out of order to one subscriber.
        if (lastSent !== null && event.sequence <= lastSent) return;
        lastSent = event.sequence;
        subscriber.next(event);
      };
      const listener: Listener = {
        deliver: (event) => {
          if (lastSent === null) buffered.push(event);
          else send(event);
        },
        complete: () => {
          if (lastSent === null) {
            completeRequested = true;

            return;
          }
          remove();
          subscriber.complete();
        },
      };

      const set = this.listeners.get(reviewId) ?? new Set<Listener>();
      set.add(listener);
      this.listeners.set(reviewId, set);

      const load = async () => {
        // Order matters: register, then read the persisted sequence, then load.
        const sequence = await this.sequences.getEventSequence(reviewId);
        const job = sequence === null ? null : await loadSnapshot();

        return { sequence: sequence ?? 0, job };
      };

      load().then(
        ({ sequence, job }) => {
          if (closed) return;
          if (!job) {
            remove();
            subscriber.complete();

            return;
          }

          send({
            reviewId,
            sequence,
            emittedAt: this.clock().toISOString(),
            type: 'job.snapshot',
            payload: { job },
          });
          for (const event of buffered.splice(0)) send(event);

          if (isTerminal(job.state) || completeRequested) {
            remove();
            subscriber.complete();
          }
        },
        (error: unknown) => {
          remove();
          if (!closed) subscriber.error(error);
        },
      );

      return () => {
        closed = true;
        remove();
      };
    });
  }

  private emit(reviewId: string, body: EventBody, terminal: boolean): void {
    const previous = this.queues.get(reviewId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        let sequence: number | null;
        try {
          sequence = await this.sequences.allocateEventSequence(reviewId);
        } catch {
          // Without a durable number the event cannot be ordered safely;
          // clients recover the state from their next snapshot.
          sequence = null;
        }

        if (sequence !== null) {
          const event = {
            reviewId,
            sequence,
            emittedAt: this.clock().toISOString(),
            ...body,
          } as ReviewEvent;
          for (const listener of Array.from(this.listeners.get(reviewId) ?? [])) listener.deliver(event);
        }

        if (terminal) {
          for (const listener of Array.from(this.listeners.get(reviewId) ?? [])) listener.complete();
          this.listeners.delete(reviewId);
        }
      })
      .catch(() => undefined);

    this.queues.set(reviewId, next);
    void next.then(() => {
      if (this.queues.get(reviewId) === next) this.queues.delete(reviewId);
    });
  }
}

function times(details: { startedAt?: string | null; completedAt?: string | null }) {
  return {
    ...(details.startedAt === undefined ? {} : { startedAt: details.startedAt }),
    ...(details.completedAt === undefined ? {} : { completedAt: details.completedAt }),
  };
}
