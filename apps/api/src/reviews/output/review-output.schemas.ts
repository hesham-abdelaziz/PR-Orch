import {
  CoverageExclusionSchema,
  FindingProbeSchema,
  ReviewFindingSchema,
  ReviewerResultSchema,
  VerifiedReportSchema,
  VerifierDecisionSchema,
} from '@pr-orchestrator/contracts';
import { z } from 'zod';

/**
 * Wire schemas: what a model is asked to emit. They reuse the field
 * constraints of the shared contract schemas but differ in three deliberate
 * ways so every provider's structured-output mode accepts them:
 *
 * - `id` and `origins` are absent; the engine assigns them.
 * - Optional fields are required-but-nullable.
 * - Paths are free strings; the engine normalizes and validates them and then
 *   re-validates each finding with the authoritative `ReviewFindingSchema`.
 */
const PathTextSchema = z.string().trim().min(1).max(2_048);

const LocationOutputSchema = z.strictObject({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive().nullable(),
  description: z.string().trim().min(1).max(500).nullable(),
});

/** A reviewer's finding. `probe` is required-but-nullable: null unless the reviewer ran one. */
export const FindingOutputSchema = z.strictObject({
  title: ReviewFindingSchema.shape.title,
  severity: ReviewFindingSchema.shape.severity,
  filePath: PathTextSchema,
  location: LocationOutputSchema,
  evidence: ReviewFindingSchema.shape.evidence,
  impact: ReviewFindingSchema.shape.impact,
  suggestedFix: ReviewFindingSchema.shape.suggestedFix,
  reference: ReviewFindingSchema.shape.reference.unwrap().nullable(),
  probe: FindingProbeSchema.nullable(),
});

/** The verifier's canonical finding: the probe is chosen by candidate id, never re-typed. */
export const VerifiedFindingOutputSchema = FindingOutputSchema.omit({ probe: true });

export const ExclusionOutputSchema = z.strictObject({
  path: PathTextSchema,
  reason: CoverageExclusionSchema.shape.reason,
});

/** One review-protocol area the reviewer attests it examined (or that does not apply). */
export const CoverageOutputSchema = z.strictObject({
  area: z.string().trim().min(1).max(100),
  status: z.enum(['checked', 'not_applicable']),
  note: z.string().trim().min(1).max(500),
});

export const ReviewerOutputSchema = z.strictObject({
  findings: z.array(FindingOutputSchema).max(500),
  warnings: ReviewerResultSchema.shape.warnings,
  exclusions: z.array(ExclusionOutputSchema).max(1_000),
  coverage: z.array(CoverageOutputSchema).max(200),
});

export const VerifierDecisionOutputSchema = z
  .strictObject({
    candidateIds: VerifierDecisionSchema.shape.candidateIds,
    verdict: VerifierDecisionSchema.shape.verdict,
    rationale: VerifierDecisionSchema.shape.rationale,
    /**
     * Required when an accepted/merged finding moves away from every
     * referenced candidate's location (another file, or more than a few lines
     * away): why the candidates' location was wrong. Null otherwise.
     */
    locationCorrection: z.string().trim().min(1).max(1_000).nullable(),
    /**
     * Id of the decided candidate whose probe the finding keeps; the engine
     * copies it verbatim. Null when no probe supports the finding.
     */
    probeFromCandidate: z.string().uuid().nullable(),
    finding: VerifiedFindingOutputSchema.nullable(),
  })
  .superRefine((decision, context) => {
    const requiresFinding = decision.verdict !== 'rejected';

    if (requiresFinding && decision.finding === null) {
      context.addIssue({
        code: 'custom',
        path: ['finding'],
        message: 'Accepted and merged decisions require a finding',
      });
    }
    if (!requiresFinding && decision.locationCorrection !== null) {
      context.addIssue({
        code: 'custom',
        path: ['locationCorrection'],
        message: 'Rejected decisions must set locationCorrection to null',
      });
    }
    if (!requiresFinding && decision.probeFromCandidate !== null) {
      context.addIssue({
        code: 'custom',
        path: ['probeFromCandidate'],
        message: 'Rejected decisions must set probeFromCandidate to null',
      });
    }
    if (!requiresFinding && decision.finding !== null) {
      context.addIssue({
        code: 'custom',
        path: ['finding'],
        message: 'Rejected decisions must set finding to null',
      });
    }
  });

export const VerifierOutputSchema = z.strictObject({
  summary: VerifiedReportSchema.shape.executiveSummary,
  decisions: z.array(VerifierDecisionOutputSchema).min(1).max(1_000),
  warnings: VerifiedReportSchema.shape.warnings,
});

export type FindingOutput = z.infer<typeof FindingOutputSchema>;
export type VerifiedFindingOutput = z.infer<typeof VerifiedFindingOutputSchema>;
export type CoverageOutput = z.infer<typeof CoverageOutputSchema>;
export type ReviewerOutput = z.infer<typeof ReviewerOutputSchema>;
export type VerifierDecisionOutput = z.infer<typeof VerifierDecisionOutputSchema>;
export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;
