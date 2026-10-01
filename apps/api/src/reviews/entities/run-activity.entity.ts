import type {
  ActivityAction,
  ActivityKind,
  ActivityOutcome,
  ActivityTarget,
  ActivityVisibility,
} from '@pr-orchestrator/contracts';

/**
 * Persistence record for table `run_activity`: one normalized, bounded
 * activity entry of a reviewer or verifier run. Never carries prompts, model
 * text, tool output or command arguments; only allowlisted fields.
 */
export interface RunActivityRecord {
  jobId: string;
  runId: string;
  /** Per-run sequence starting at 1; (runId, seq) is unique. */
  seq: number;
  at: string;
  kind: ActivityKind;
  /** Stored as JSON in `run_activity.payload`. */
  payload: RunActivityPayload;
}

export interface RunActivityPayload {
  action: ActivityAction;
  attempt?: number;
  tool?: string;
  target?: ActivityTarget;
  outcome?: ActivityOutcome;
  count?: number;
}

/**
 * Per-run activity bookkeeping stored on `reviewer_runs`
 * (`activity_visibility`, `activity_count`, `last_activity_at`). Populated by
 * `listRuns`; `saveRun` never writes it.
 */
export interface RunActivityState {
  visibility: ActivityVisibility | null;
  /** Highest sequence ever recorded for the run (entries may have been pruned). */
  count: number;
  /** Time of the newest `provider`-kind entry; lifecycle, notices and heartbeats never move it. */
  lastActivityAt: string | null;
}
