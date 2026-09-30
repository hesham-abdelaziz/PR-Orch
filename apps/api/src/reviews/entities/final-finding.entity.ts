import type { ReviewFinding, VerifierDecision } from '@pr-orchestrator/contracts';

/** Persistence record for table `final_findings` (verified findings only). */
export interface FinalFindingRecord {
  id: string;
  jobId: string;
  finding: ReviewFinding;
  /** The accepted or merged decision that produced this finding. */
  decision: VerifierDecision;
}
