import type { JobState } from '@pr-orchestrator/contracts';

import type { JobPatch } from './entities/review-job.entity.js';
import type { ReviewRepository, TransitionResult } from './review-repository.js';

export const TERMINAL_STATES: readonly JobState[] = ['completed', 'failed', 'cancelled'];

/**
 * The only legal moves. Every non-terminal state can fail or start cancelling;
 * `cancelling` can only end in `cancelled`, so a cancelled job never reports
 * completion and a completed job never becomes cancelled.
 */
const TRANSITIONS: Readonly<Record<JobState, readonly JobState[]>> = {
  queued: ['preparing', 'failed', 'cancelling'],
  preparing: ['reviewing', 'failed', 'cancelling'],
  reviewing: ['verifying', 'failed', 'cancelling'],
  verifying: ['rendering', 'failed', 'cancelling'],
  rendering: ['completed', 'failed', 'cancelling'],
  cancelling: ['cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(from: JobState, to: JobState) {
    super(`Illegal job transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

const MAX_ATTEMPTS = 5;

/** Applies validated, persisted transitions with compare-and-set semantics. */
export class JobStateMachine {
  constructor(
    private readonly repository: ReviewRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Moves a job to `to` if that is legal from its current state.
   *
   * - Terminal jobs are immutable: the request is a no-op (`applied: false`).
   * - A job that is already `cancelling` only accepts `cancelled`; any other
   *   request loses to the cancellation and is a no-op.
   * - Any other illegal move is a programming error and throws.
   */
  async transition(jobId: string, to: JobState, patch?: JobPatch): Promise<TransitionResult> {
    let last: TransitionResult = { applied: false, job: null };

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const job = await this.repository.getJob(jobId);
      if (!job) return { applied: false, job: null };
      if (isTerminal(job.state) || job.state === to) return { applied: false, job };
      if (!canTransition(job.state, to)) {
        if (job.state === 'cancelling') return { applied: false, job };
        throw new IllegalTransitionError(job.state, to);
      }

      last = await this.repository.transitionJob({
        jobId,
        expectedFrom: job.state,
        to,
        ...(patch ? { patch } : {}),
        at: this.clock().toISOString(),
      });
      if (last.applied) return last;
    }

    return last;
  }
}
