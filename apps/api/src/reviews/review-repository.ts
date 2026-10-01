import type { ActivityVisibility, JobState } from '@pr-orchestrator/contracts';

import type { ReportRecord } from '../reports/entities/report.entity.js';
import type { CandidateFindingRecord } from './entities/candidate-finding.entity.js';
import type { FinalFindingRecord } from './entities/final-finding.entity.js';
import type { JobPatch, ReviewJobRecord } from './entities/review-job.entity.js';
import type { ReviewerRunRecord } from './entities/reviewer-run.entity.js';
import type { RunActivityRecord } from './entities/run-activity.entity.js';

export const REVIEW_REPOSITORY = Symbol('REVIEW_REPOSITORY');

export type CreateJobResult =
  | { created: true; job: ReviewJobRecord }
  | { created: false; activeJobId: string };

export type TransitionResult =
  | { applied: true; job: ReviewJobRecord }
  /** `job` is the current row (null if it does not exist) when the change lost. */
  | { applied: false; job: ReviewJobRecord | null };

export interface TransitionInput {
  jobId: string;
  /** Compare-and-set guard: applied only if the job is still in this state. */
  expectedFrom: JobState;
  to: JobState;
  patch?: JobPatch;
  at: string;
}

export interface CompleteJobInput {
  jobId: string;
  report: ReportRecord;
  finalFindings: FinalFindingRecord[];
  patch?: JobPatch;
  at: string;
}

export type HistoryStatus =
  | 'active'
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'cancelled';

export interface ReviewHistoryFilter {
  /** Case-insensitive substring of `project/repository`. */
  repository?: string;
  /** Matches when the provider is the main verifier or any reviewer. */
  provider?: 'claude' | 'codex' | 'gemini';
  status?: HistoryStatus;
  risk?: 'critical' | 'high' | 'medium' | 'low' | 'clean';
  /** Inclusive ISO timestamps compared against `createdAt`. */
  from?: string;
  to?: string;
  /** Case-insensitive substring of the PR title or repository. */
  text?: string;
}

export interface HistoryPage {
  limit: number;
  /** Opaque cursor returned by a previous page. */
  cursor?: string;
}

/**
 * Durable per-job SSE sequence counter (`review_jobs.event_sequence`). The
 * value only ever increases and outlives the job becoming terminal and the
 * process restarting, so a reconnecting client never sees a sequence regress.
 */
export interface EventSequenceStore {
  /**
   * Atomically increments the job's counter and returns the new value, e.g.
   * `UPDATE review_jobs SET event_sequence = event_sequence + 1 WHERE id = ?
   * RETURNING event_sequence`. Returns null when the job does not exist.
   */
  allocateEventSequence(jobId: string): Promise<number | null>;
  /** The last allocated value (0 before the first event); null when the job does not exist. */
  getEventSequence(jobId: string): Promise<number | null>;
}

/**
 * Bounded per-run activity log (table `run_activity`) plus the bookkeeping
 * columns on `reviewer_runs`. Only the newest `retain` entries of a run are
 * kept; `activity_count` and `last_activity_at` survive pruning.
 */
export interface RunActivityStore {
  /**
   * One transaction:
   * 1. insert the row (a duplicate `(runId, seq)` is an error);
   * 2. `activity_count = MAX(activity_count, seq)` on the run;
   * 3. when `kind = 'provider'`, `last_activity_at = MAX(last_activity_at, at)`;
   * 4. delete the run's rows with `seq <= record.seq - retain`.
   */
  appendRunActivity(record: RunActivityRecord, retain: number): Promise<void>;
  /** Sets `reviewer_runs.activity_visibility` for the run. */
  setRunActivityVisibility(jobId: string, runId: string, visibility: ActivityVisibility): Promise<void>;
  /** The newest `perRunLimit` entries of every run of the job, ordered by run, then `seq` ascending. */
  listRunActivity(jobId: string, perRunLimit: number): Promise<RunActivityRecord[]>;
  /** The newest `limit` entries of one run, `seq` ascending; empty when the run is unknown. */
  listRunActivityForRun(jobId: string, runId: string, limit: number): Promise<RunActivityRecord[]>;
}

/**
 * Persistence port implemented by the platform with SQLite. These operations
 * must be atomic in the database, not merely in memory:
 *
 * - `createJob`: at most one non-terminal job may exist (partial unique index).
 * - `transitionJob` / `completeJob`: compare-and-set on `state`, with the
 *   report insert and state change in one transaction.
 * - `allocateEventSequence`: a single atomic increment-and-return.
 * - `appendRunActivity`: insert, bookkeeping and pruning in one transaction.
 */
export interface ReviewRepository extends EventSequenceStore, RunActivityStore {
  /**
   * Inserts the job and its initial (queued) runs in one transaction, so a
   * reader never sees a job without its reviewers. Loses cleanly, inserting
   * nothing, when another non-terminal job exists.
   */
  createJob(record: ReviewJobRecord, initialRuns?: ReviewerRunRecord[]): Promise<CreateJobResult>;
  getJob(jobId: string): Promise<ReviewJobRecord | null>;
  getActiveJob(): Promise<ReviewJobRecord | null>;
  listNonTerminalJobs(): Promise<ReviewJobRecord[]>;
  /** Terminal jobs whose temporary workspace has not been deleted yet. */
  listJobsPendingCleanup(): Promise<ReviewJobRecord[]>;
  transitionJob(input: TransitionInput): Promise<TransitionResult>;
  /** Updates non-state fields such as warnings or cleanup flags. */
  updateJob(jobId: string, patch: JobPatch, at: string): Promise<ReviewJobRecord | null>;
  /** Insert-or-replace a run row. */
  saveRun(run: ReviewerRunRecord): Promise<void>;
  listRuns(jobId: string): Promise<ReviewerRunRecord[]>;
  saveCandidates(records: CandidateFindingRecord[]): Promise<void>;
  listCandidates(jobId: string): Promise<CandidateFindingRecord[]>;
  /**
   * Atomically moves `rendering -> completed` and stores the immutable report.
   * Must refuse (applied: false) if the job is no longer in `rendering`.
   */
  completeJob(input: CompleteJobInput): Promise<TransitionResult>;
  getReport(jobId: string): Promise<ReportRecord | null>;
  queryJobs(
    filter: ReviewHistoryFilter,
    page: HistoryPage,
  ): Promise<{ items: ReviewJobRecord[]; nextCursor: string | null }>;
}
