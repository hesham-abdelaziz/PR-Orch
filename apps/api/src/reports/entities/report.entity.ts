import type { VerifiedReport } from '@pr-orchestrator/contracts';

/** Persistence record for table `reports`. Written once; never updated. */
export interface ReportRecord {
  jobId: string;
  report: VerifiedReport;
  markdown: string;
  durationMs: number;
  createdAt: string;
}
