import { Inject, Injectable } from '@nestjs/common';
import {
  OverallRiskSchema,
  ProviderIdSchema,
  type ReviewJob,
  type VerifiedReport,
} from '@pr-orchestrator/contracts';
import { z } from 'zod';

import type { OverallRisk } from '../reviews/entities/review-job.entity.js';
import { toReviewJob } from '../reviews/review-job.mapper.js';
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
  constructor(@Inject(REVIEW_REPOSITORY) private readonly repository: ReviewRepository) {}

  async getReview(reviewId: string): Promise<ReviewJob | null> {
    const record = await this.repository.getJob(reviewId);

    return record ? toReviewJob(record, await this.repository.listRuns(record.id)) : null;
  }

  async getActiveReview(): Promise<ReviewJob | null> {
    const record = await this.repository.getActiveJob();

    return record ? toReviewJob(record, await this.repository.listRuns(record.id)) : null;
  }

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
