import type {
  CoverageExclusionSchema,
  JobState,
  ModelSelection,
  OverallRiskSchema,
  PullRequestSummary,
  Settings,
  StandardsMetadata,
} from '@pr-orchestrator/contracts';
import type { z } from 'zod';

export type CoverageExclusion = z.infer<typeof CoverageExclusionSchema>;
export type OverallRisk = z.infer<typeof OverallRiskSchema>;

/**
 * Persistence record for table `review_jobs`. TypeORM is not installed on the
 * engine branch, so this is a plain shape; the platform owner maps it to an
 * entity and the `003-review-engine` migration (see reviews/README.md for the
 * required columns and the partial unique index that enforces one active job).
 */
export interface ReviewJobRecord {
  id: string;
  state: JobState;
  pullRequest: PullRequestSummary;
  main: ModelSelection;
  reviewers: ModelSelection[];
  additionalInstructions: string | null;
  /** Standards snapshot taken at creation; later replacements never change it. */
  standards: StandardsMetadata | null;
  standardsStoragePath: string | null;
  /** Settings frozen at creation so a running job is unaffected by later edits. */
  settings: Settings;
  warnings: string[];
  exclusions: CoverageExclusion[];
  failureReason: string | null;
  workspaceId: string | null;
  /** True while a temporary workspace still has to be deleted. */
  cleanupPending: boolean;
  /** Denormalized from the report for history filtering; null until completed. */
  overallRisk: OverallRisk | null;
  findingCount: number | null;
  /**
   * Last SSE event sequence allocated for this job (0 before the first event).
   * Changed only through `ReviewRepository.allocateEventSequence`, never by a
   * `JobPatch`.
   */
  eventSequence: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type JobPatch = Partial<
  Pick<
    ReviewJobRecord,
    | 'pullRequest'
    | 'warnings'
    | 'exclusions'
    | 'failureReason'
    | 'workspaceId'
    | 'cleanupPending'
    | 'overallRisk'
    | 'findingCount'
  >
>;
