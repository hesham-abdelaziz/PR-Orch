import type { ReviewFinding, Severity, VerifierDecision } from '@pr-orchestrator/contracts';

/**
 * Candidate-to-final audit for one verified finding. It records what was
 * checked objectively; it is not a proof that the claim is semantically right.
 */
export interface FindingVerificationAudit {
  /** The referenced candidates as the reviewers reported them. */
  candidates: Array<{
    id: string;
    title: string;
    severity: Severity;
    filePath: string;
    startLine: number;
    endLine: number | null;
  }>;
  /** True when the final location is not in or near any referenced candidate's location. */
  relocated: boolean;
  /** The verifier's explanation for a relocation; null when not relocated. */
  locationCorrection: string | null;
  /** Checkout line where a code excerpt quoted in the evidence was found. */
  evidenceLine: number;
  /** True when the final severity differs from every referenced candidate's severity. */
  severityChanged: boolean;
}

/** Persistence record for table `final_findings` (verified findings only). */
export interface FinalFindingRecord {
  id: string;
  jobId: string;
  finding: ReviewFinding;
  /** The accepted or merged decision that produced this finding. */
  decision: VerifierDecision;
  verification: FindingVerificationAudit;
}
