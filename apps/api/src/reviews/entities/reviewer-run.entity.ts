import type { ModelSelection, ReviewerResult, RunState } from '@pr-orchestrator/contracts';

/** Persistence record for table `reviewer_runs` (reviewers and the main verifier). */
export interface ReviewerRunRecord {
  id: string;
  jobId: string;
  role: 'reviewer' | 'verifier';
  selection: ModelSelection;
  state: RunState;
  startedAt: string | null;
  completedAt: string | null;
  /** Actionable, secret-free reason when the run did not complete. */
  warning: string | null;
  /** Provider invocations used, including the single allowed correction. */
  attempts: number;
  /** Redacted, size-bounded diagnostics; never a full provider transcript. */
  sanitizedLog: string;
  /** Normalized result for reviewers; null for the verifier and failed runs. */
  result: ReviewerResult | null;
}
