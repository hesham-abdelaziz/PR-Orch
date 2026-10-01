import type { ModelSelection, ReviewerResult, RunState } from '@pr-orchestrator/contracts';

import type { RunActivityState } from './run-activity.entity.js';

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
  /**
   * Read-only activity bookkeeping returned by `listRuns` (absent or zeroed for
   * runs that never recorded activity). `saveRun` ignores it.
   */
  activity?: RunActivityState;
}
