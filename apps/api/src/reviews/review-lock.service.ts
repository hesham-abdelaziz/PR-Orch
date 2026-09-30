import type { JobState } from '@pr-orchestrator/contracts';

import type { ReviewJobRecord } from './entities/review-job.entity.js';
import { JobStateMachine, isTerminal } from './job-state-machine.js';
import type { CreateJobResult, ReviewRepository } from './review-repository.js';

export interface RecoveredJob {
  jobId: string;
  from: JobState;
  to: JobState;
  workspaceId: string | null;
}

export const INTERRUPTED_REASON =
  'Interrupted by an application restart; the review was not resumed.';

/**
 * Enforces "one active review". The database (unique active-job index) is the
 * authority; the in-process mutex only serializes creators so losers get a
 * clean answer instead of racing on constraint errors.
 */
export class ReviewLockService {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repository: ReviewRepository,
    private readonly stateMachine: JobStateMachine,
  ) {}

  runExclusive<T>(critical: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => critical());
    this.tail = run.catch(() => undefined);

    return run;
  }

  createExclusive(record: ReviewJobRecord): Promise<CreateJobResult> {
    return this.runExclusive(() => this.repository.createJob(record));
  }

  /**
   * Startup recovery: a job left in an active state cannot still be running, so
   * it is failed (or cancelled, if cancellation had already begun). This frees
   * the single-active-job lock. Jobs are never resumed.
   */
  async recoverAfterRestart(): Promise<RecoveredJob[]> {
    const recovered: RecoveredJob[] = [];

    for (const job of await this.repository.listNonTerminalJobs()) {
      if (isTerminal(job.state)) continue;

      const to: JobState = job.state === 'cancelling' ? 'cancelled' : 'failed';
      const result = await this.stateMachine.transition(job.id, to, {
        ...(to === 'failed' ? { failureReason: INTERRUPTED_REASON } : {}),
        cleanupPending: job.workspaceId !== null,
      });
      if (result.applied) {
        recovered.push({ jobId: job.id, from: job.state, to, workspaceId: job.workspaceId });
      }
    }

    return recovered;
  }
}
