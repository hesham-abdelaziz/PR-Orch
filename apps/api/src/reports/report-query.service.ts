import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  OverallRiskSchema,
  ProviderIdSchema,
  RUN_ACTIVITY_RETAINED_PER_RUN,
  RUN_ACTIVITY_SNAPSHOT_PER_RUN,
  type ReviewJob,
  type RunActivityLog,
  type VerifiedReport,
} from '@pr-orchestrator/contracts';
import { z } from 'zod';

import type { OverallRisk } from '../reviews/entities/review-job.entity.js';
import type { ReviewJobRecord } from '../reviews/entities/review-job.entity.js';
import { toReviewJob, toRunActivity } from '../reviews/review-job.mapper.js';
import { RunLivenessService } from '../reviews/run-liveness.service.js';
import { historyStatusOf } from '../reviews/history-status.js';
import {
  REVIEW_REPOSITORY,
  type HistoryStatus,
  type ReviewRepository,
} from '../reviews/review-repository.js';

const HISTORY_STATUSES = [
  'active',
  'completed',
  'completed_with_warnings',
  'failed',
  'cancelled',
] as const satisfies readonly HistoryStatus[];

export const ReviewHistoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(500).optional(),
  status: z.enum(HISTORY_STATUSES).optional(),
  risk: OverallRiskSchema.optional(),
  provider: ProviderIdSchema.optional(),
  repository: z.string().trim().min(1).max(300).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().trim().min(1).max(200).optional(),
});
export type ReviewHistoryQuery = z.infer<typeof ReviewHistoryQuerySchema>;

export interface ReviewHistoryItem {
  review: ReviewJob;
  status: HistoryStatus;
  overallRisk: OverallRisk | null;
  findingCount: number | null;
}

export interface ReviewHistoryPage {
  items: ReviewHistoryItem[];
  nextCursor: string | null;
}

export interface StoredMarkdownReport {
  markdown: string;
  filename: string;
}

/** Read side of the engine: job snapshots, history, and stored reports. */
@Injectable()
export class ReportQueryService {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly repository: ReviewRepository,
    @Optional() @Inject(RunLivenessService) private readonly liveness: RunLivenessService = new RunLivenessService(),
  ) {}

  /** Full snapshot, including each run's recent activity (used by GET and the SSE snapshot). */
  async getReview(reviewId: string): Promise<ReviewJob | null> {
    const record = await this.repository.getJob(reviewId);

    return record ? this.withActivity(record) : null;
  }

  async getActiveReview(): Promise<ReviewJob | null> {
    const record = await this.repository.getActiveJob();

    return record ? this.withActivity(record) : null;
  }

  /**
   * The retained activity log of one run (newest RUN_ACTIVITY_RETAINED_PER_RUN
   * entries, oldest first); null when the review or run does not exist.
   */
  async getRunActivity(reviewId: string, runId: string): Promise<RunActivityLog | null> {
    const run = (await this.repository.listRuns(reviewId)).find((candidate) => candidate.id === runId);
    if (!run) return null;
    const rows = await this.repository.listRunActivityForRun(reviewId, runId, RUN_ACTIVITY_RETAINED_PER_RUN);
    const items = rows.flatMap((row) => toRunActivity(row) ?? []);

    return { runId, items, total: Math.max(run.activity?.count ?? 0, items.at(-1)?.seq ?? 0) };
  }

  private async withActivity(record: ReviewJobRecord): Promise<ReviewJob> {
    return toReviewJob(record, await this.repository.listRuns(record.id), {
      entries: await this.repository.listRunActivity(record.id, RUN_ACTIVITY_SNAPSHOT_PER_RUN),
      lastHeartbeat: (runId) => this.liveness.lastHeartbeat(runId),
    });
  }

  /** History rows stay light: no activity is loaded for them. */
  async listReviews(query: ReviewHistoryQuery): Promise<ReviewHistoryPage> {
    const { limit, cursor, q, ...rest } = query;
    const page = await this.repository.queryJobs(
      { ...rest, ...(q === undefined ? {} : { text: q }) },
      cursor === undefined ? { limit } : { limit, cursor },
    );

    const items = await Promise.all(
      page.items.map(async (record) => ({
        review: toReviewJob(record, await this.repository.listRuns(record.id)),
        status: historyStatusOf(record),
        overallRisk: record.overallRisk,
        findingCount: record.findingCount,
      })),
    );

    return { items, nextCursor: page.nextCursor };
  }

  /** Structured report; a deep copy so callers cannot mutate stored state. */
  async getReport(reviewId: string): Promise<VerifiedReport | null> {
    const stored = await this.repository.getReport(reviewId);

    return stored ? structuredClone(stored.report) : null;
  }

  async getReportMarkdown(reviewId: string): Promise<StoredMarkdownReport | null> {
    const stored = await this.repository.getReport(reviewId);

    return stored ? { markdown: stored.markdown, filename: `review-${reviewId}.md` } : null;
  }
}
