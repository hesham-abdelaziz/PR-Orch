import type { ReviewJob } from '@pr-orchestrator/contracts';

import type { ReviewJobRecord } from './entities/review-job.entity.js';
import type { ReviewerRunRecord } from './entities/reviewer-run.entity.js';

/** Maps persistence rows to the shared `ReviewJob` DTO (reviewers only; the verifier run is internal). */
export function toReviewJob(record: ReviewJobRecord, runs: readonly ReviewerRunRecord[]): ReviewJob {
  const orderOf = (run: ReviewerRunRecord) =>
    record.reviewers.findIndex(
      (reviewer) =>
        reviewer.provider === run.selection.provider && reviewer.model === run.selection.model,
    );

  return {
    id: record.id,
    state: record.state,
    pullRequest: record.pullRequest,
    main: record.main,
    reviewers: runs
      .filter((run) => run.role === 'reviewer')
      .sort((left, right) => orderOf(left) - orderOf(right))
      .map((run) => ({
        id: run.id,
        selection: run.selection,
        state: run.state,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        warning: run.warning,
      })),
    standards: record.standards,
    warnings: record.warnings,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}
