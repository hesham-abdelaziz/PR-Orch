import { z } from 'zod';

import { ModelSelectionSchema } from './providers.js';

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const NormalizedRelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) => {
      const segments = value.split('/');

      return (
        !value.includes('\\') &&
        !value.startsWith('/') &&
        !/^[A-Za-z]:/.test(value) &&
        !value.includes('://') &&
        segments.every(
          (segment) => segment.length > 0 && segment !== '.' && segment !== '..',
        )
      );
    },
    { message: 'Expected a normalized relative POSIX path' },
  );

export const FindingLocationSchema = z
  .strictObject({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive().optional(),
    description: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((location, context) => {
    if (
      location.endLine !== undefined &&
      location.endLine < location.startLine
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endLine'],
        message: 'endLine must be greater than or equal to startLine',
      });
    }
  });

export const CoverageExclusionSchema = z.strictObject({
  path: NormalizedRelativePathSchema,
  reason: z.string().trim().min(1).max(500),
});

export const ReviewAreaSourceSchema = z.enum(['protocol', 'standards']);
export const ReviewAreaStatusSchema = z.enum(['checked', 'not_applicable', 'missing']);

/** One required review area and what a reviewer attested for it ('missing' = no entry). */
export const ReviewAreaCoverageSchema = z.strictObject({
  area: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  source: ReviewAreaSourceSchema,
  status: ReviewAreaStatusSchema,
  /** The reviewer's note; absent when status is 'missing'. */
  note: z.string().trim().min(1).max(500).optional(),
});

export const ReviewerCoverageSchema = z.strictObject({
  reviewer: ModelSelectionSchema,
  areas: z.array(ReviewAreaCoverageSchema).max(200),
});

export const ReviewFindingSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  severity: SeveritySchema,
  filePath: NormalizedRelativePathSchema,
  location: FindingLocationSchema,
  evidence: z.string().trim().min(1).max(5_000),
  impact: z.string().trim().min(1).max(5_000),
  suggestedFix: z.string().trim().min(1).max(5_000),
  reference: z.string().trim().min(1).max(1_000).optional(),
  origins: z.array(ModelSelectionSchema).min(1).max(8),
});

export const ReviewerResultSchema = z.strictObject({
  reviewer: ModelSelectionSchema,
  coverage: z.array(ReviewAreaCoverageSchema).max(200).optional(),
  findings: z.array(ReviewFindingSchema).max(500),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(100),
  exclusions: z.array(CoverageExclusionSchema).max(1_000),
});

export const VerifierDecisionSchema = z
  .strictObject({
    candidateIds: z.array(z.string().uuid()).min(1).max(500),
    verdict: z.enum(['accepted', 'rejected', 'merged']),
    rationale: z.string().trim().min(1).max(5_000),
    finding: ReviewFindingSchema.optional(),
  })
  .superRefine((decision, context) => {
    const requiresFinding =
      decision.verdict === 'accepted' || decision.verdict === 'merged';

    if (requiresFinding && decision.finding === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['finding'],
        message: 'Accepted and merged decisions require a finding',
      });
    }

    if (decision.verdict === 'rejected' && decision.finding !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['finding'],
        message: 'Rejected decisions cannot contain a final finding',
      });
    }
  });

export const OverallRiskSchema = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'clean',
]);

export const VerifiedReportSchema = z.strictObject({
  reviewId: z.string().uuid(),
  executiveSummary: z.string().trim().min(1).max(10_000),
  overallRisk: OverallRiskSchema,
  /** One entry per completed reviewer, in reviewer order. */
  coverage: z.array(ReviewerCoverageSchema).max(10).optional(),
  findings: z.array(ReviewFindingSchema).max(500),
  decisions: z.array(VerifierDecisionSchema).max(1_000),
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  mergedCount: z.number().int().nonnegative(),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(100),
  exclusions: z.array(CoverageExclusionSchema).max(1_000),
});

export type Severity = z.infer<typeof SeveritySchema>;
export type ReviewAreaCoverage = z.infer<typeof ReviewAreaCoverageSchema>;
export type ReviewerCoverage = z.infer<typeof ReviewerCoverageSchema>;
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewerResult = z.infer<typeof ReviewerResultSchema>;
export type VerifierDecision = z.infer<typeof VerifierDecisionSchema>;
export type VerifiedReport = z.infer<typeof VerifiedReportSchema>;
