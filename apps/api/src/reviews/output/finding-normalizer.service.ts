import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
  CoverageExclusionSchema,
  ReviewFindingSchema,
  ReviewerResultSchema,
  type ModelSelection,
  type ReviewFinding,
  type ReviewerResult,
} from '@pr-orchestrator/contracts';

import { validateFindingPath, type PathRejection } from './finding-path.validator.js';
import type { FindingOutput, ReviewerOutput } from './review-output.schemas.js';

export interface DroppedFinding {
  /** The finding title, or the path for a dropped coverage exclusion. */
  title: string;
  reason: PathRejection | 'invalid_finding';
}

export interface NormalizeReviewerInput {
  reviewer: ModelSelection;
  /** Absolute checkout directory the reviewer inspected. */
  workspaceRoot: string;
  output: ReviewerOutput;
}

export interface NormalizedReviewer {
  result: ReviewerResult;
  dropped: DroppedFinding[];
}

/** Deterministic RFC 4122 version-5-shaped UUID derived from a seed string. */
export function stableUuid(seed: string): string {
  const bytes = Buffer.from(createHash('sha256').update(seed).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable candidate id: provider, model, normalized path, line range, and title. */
export function candidateId(
  reviewer: ModelSelection,
  filePath: string,
  location: { startLine: number; endLine?: number | null },
  title: string,
): string {
  return stableUuid(
    [
      reviewer.provider,
      reviewer.model,
      filePath,
      `${location.startLine}-${location.endLine ?? ''}`,
      title.trim().toLowerCase(),
    ].join('\u0000'),
  );
}

@Injectable()
export class FindingNormalizerService {
  /**
   * Converts validated model output into contract-valid candidate findings.
   * Unsafe or invalid findings are dropped and reported, never repaired.
   */
  normalizeReviewer(input: NormalizeReviewerInput): NormalizedReviewer {
    const dropped: DroppedFinding[] = [];
    const findings = new Map<string, ReviewFinding>();

    for (const raw of input.output.findings) {
      const path = validateFindingPath(raw.filePath, input.workspaceRoot);
      if (!path.ok) {
        dropped.push({ title: raw.title, reason: path.reason });
        continue;
      }

      const finding = this.toFinding(input.reviewer, raw, path.path);
      if (finding === undefined) {
        dropped.push({ title: raw.title, reason: 'invalid_finding' });
        continue;
      }
      if (!findings.has(finding.id)) findings.set(finding.id, finding);
    }

    const exclusions: ReviewerResult['exclusions'] = [];
    for (const exclusion of input.output.exclusions) {
      const path = validateFindingPath(exclusion.path, input.workspaceRoot);
      if (!path.ok) {
        dropped.push({ title: exclusion.path, reason: path.reason });
        continue;
      }
      const parsed = CoverageExclusionSchema.safeParse({ path: path.path, reason: exclusion.reason });
      if (parsed.success) exclusions.push(parsed.data);
    }

    const result = ReviewerResultSchema.parse({
      reviewer: input.reviewer,
      findings: [...findings.values()],
      warnings: input.output.warnings,
      exclusions,
    });

    return { result, dropped };
  }

  private toFinding(
    reviewer: ModelSelection,
    raw: FindingOutput,
    filePath: string,
  ): ReviewFinding | undefined {
    const parsed = ReviewFindingSchema.safeParse({
      id: candidateId(reviewer, filePath, raw.location, raw.title),
      title: raw.title,
      severity: raw.severity,
      filePath,
      location: {
        startLine: raw.location.startLine,
        ...(raw.location.endLine === null ? {} : { endLine: raw.location.endLine }),
        ...(raw.location.description === null ? {} : { description: raw.location.description }),
      },
      evidence: raw.evidence,
      impact: raw.impact,
      suggestedFix: raw.suggestedFix,
      ...(raw.reference === null ? {} : { reference: raw.reference }),
      origins: [reviewer],
    });

    return parsed.success ? parsed.data : undefined;
  }
}
