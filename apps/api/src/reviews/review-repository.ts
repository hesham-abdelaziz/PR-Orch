import type { JobState } from '@pr-orchestrator/contracts';

import type { ReportRecord } from '../reports/entities/report.entity.js';
import type { CandidateFindingRecord } from './entities/candidate-finding.entity.js';
import type { FinalFindingRecord } from './entities/final-finding.entity.js';
import type { JobPatch, ReviewJobRecord } from './entities/review-job.entity.js';
import type { ReviewerRunRecord } from './entities/reviewer-run.entity.js';

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
 * Persistence port implemented by the platform with SQLite. Two operations
 * must be atomic in the database, not merely in memory:
 *
 * - `createJob`: at most one non-terminal job may exist (partial unique index).
 * - `transitionJob` / `completeJob`: compare-and-set on `state`, with the
 *   report insert and state change in one transaction.
 */
export interface ReviewRepository {
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
