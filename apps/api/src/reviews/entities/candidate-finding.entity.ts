import type { ReviewFinding } from '@pr-orchestrator/contracts';

/** Persistence record for table `candidate_findings`. */
export interface CandidateFindingRecord {
  /** Stable candidate id; equals `finding.id`. */
  id: string;
  jobId: string;
  runId: string;
  finding: ReviewFinding;
}
