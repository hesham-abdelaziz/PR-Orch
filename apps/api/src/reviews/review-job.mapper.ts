import {
  RUN_ACTIVITY_SNAPSHOT_PER_RUN,
  RunActivitySchema,
  type ReviewJob,
  type RunActivity,
  type RunActivitySummary,
} from '@pr-orchestrator/contracts';

import type { ReviewJobRecord } from './entities/review-job.entity.js';
import type { ReviewerRunRecord } from './entities/reviewer-run.entity.js';
import type { RunActivityRecord } from './entities/run-activity.entity.js';

type ReviewerRun = ReviewJob['reviewers'][number];

/** Activity to embed in a job snapshot; omitted for light-weight views such as history rows. */
export interface SnapshotActivity {
  /** Recent entries of the job's runs (any order; the newest per run are kept). */
  entries: readonly RunActivityRecord[];
  /** In-memory process heartbeat of a running run, or null. */
  lastHeartbeat: (runId: string) => string | null;
}

/**
 * Maps persistence rows to the shared `ReviewJob` DTO: reviewers in selection
 * order, plus the main verifier run. With `activity`, every run carries its
 * activity summary (empty for reviews recorded before activity existed).
 */
export function toReviewJob(
  record: ReviewJobRecord,
  runs: readonly ReviewerRunRecord[],
  activity?: SnapshotActivity,
): ReviewJob {
  const orderOf = (run: ReviewerRunRecord) =>
    record.reviewers.findIndex(
      (reviewer) =>
        reviewer.provider === run.selection.provider && reviewer.model === run.selection.model,
    );
  const verifier = runs.find((run) => run.role === 'verifier');

  return {
    id: record.id,
    state: record.state,
    pullRequest: record.pullRequest,
    main: record.main,
    reviewers: runs
      .filter((run) => run.role === 'reviewer')
      .sort((left, right) => orderOf(left) - orderOf(right))
      .map((run) => toReviewerRun(run, activity)),
    ...(verifier ? { verifier: toReviewerRun(verifier, activity) } : {}),
    standards: record.standards,
    // Metadata only: the frozen content never leaves the engine.
    ...(record.repositoryGuidance
      ? {
          repositoryGuidance: {
            filename: record.repositoryGuidance.filename,
            sha256: record.repositoryGuidance.sha256,
            sizeBytes: record.repositoryGuidance.sizeBytes,
          },
        }
      : {}),
    warnings: record.warnings,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}

/** A stored entry as the contract shape, or undefined if the row no longer validates. */
export function toRunActivity(record: RunActivityRecord): RunActivity | undefined {
  const parsed = RunActivitySchema.safeParse({
    id: `${record.runId}:${record.seq}`,
    runId: record.runId,
    seq: record.seq,
    at: record.at,
    kind: record.kind,
    ...record.payload,
  });

  return parsed.success ? parsed.data : undefined;
}

function toReviewerRun(run: ReviewerRunRecord, activity: SnapshotActivity | undefined): ReviewerRun {
  const base: ReviewerRun = {
    id: run.id,
    selection: run.selection,
    state: run.state,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    warning: run.warning,
  };

  return activity ? { ...base, activity: summarize(run, activity) } : base;
}

function summarize(run: ReviewerRunRecord, activity: SnapshotActivity): RunActivitySummary {
  const rows = activity.entries
    .filter((entry) => entry.runId === run.id)
    .sort((left, right) => left.seq - right.seq)
    .slice(-RUN_ACTIVITY_SNAPSHOT_PER_RUN);
  const recent = rows.flatMap((entry) => toRunActivity(entry) ?? []);
  const current = [...recent].reverse().find((entry) => entry.kind === 'provider') ?? null;

  return {
    visibility: run.activity?.visibility ?? null,
    recent,
    current,
    lastActivityAt: run.activity?.lastActivityAt ?? current?.at ?? null,
    // A heartbeat only means something while the process may still be alive.
    lastHeartbeatAt: run.state === 'running' ? activity.lastHeartbeat(run.id) : null,
    total: Math.max(run.activity?.count ?? 0, rows.at(-1)?.seq ?? 0),
  };
}
