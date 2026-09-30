import {
  VerifiedReportSchema,
  type ModelSelection,
  type ReviewFinding,
  type Severity,
  type VerifiedReport,
  type VerifierDecision,
} from '@pr-orchestrator/contracts';

import type { CoverageExclusion } from './entities/review-job.entity.js';
import type { FinalFindingRecord } from './entities/final-finding.entity.js';
import { stableUuid, type FindingNormalizerService } from './output/finding-normalizer.service.js';
import type { VerifierOutput } from './output/review-output.schemas.js';

export interface AssembleInput {
  reviewId: string;
  output: VerifierOutput;
  candidates: readonly ReviewFinding[];
  workspaceRoot: string;
  jobWarnings: readonly string[];
  exclusions: readonly CoverageExclusion[];
  normalizer: FindingNormalizerService;
}

export type AssembleOutcome =
  | { ok: true; report: VerifiedReport; finalFindings: Array<Pick<FinalFindingRecord, 'id' | 'finding' | 'decision'>> }
  | { ok: false; issues: string[] };

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
const MAX_LISTED = 10;

const sameModel = (left: ModelSelection, right: ModelSelection) =>
  left.provider === right.provider && left.model === right.model;

/**
 * Turns validated verifier output into the canonical report, enforcing the
 * verifier contract: every candidate is decided exactly once, nothing is
 * invented, and finding identity and origins are derived by the engine.
 */
export function assembleVerifiedReport(input: AssembleInput): AssembleOutcome {
  const issues: string[] = [];
  const order = new Map(input.candidates.map((candidate, index) => [candidate.id, index]));
  const decided = new Set<string>();
  const decisions: VerifierDecision[] = [];
  const finalFindings: Array<Pick<FinalFindingRecord, 'id' | 'finding' | 'decision'>> = [];

  input.output.decisions.forEach((raw, index) => {
    const label = `Decision ${index + 1}`;
    const ids = raw.candidateIds;
    let structurallyValid = true;

    if (new Set(ids).size !== ids.length) {
      issues.push(`${label} repeats a candidate id.`);
      structurallyValid = false;
    }
    for (const id of ids) {
      if (!order.has(id)) {
        issues.push(`${label} references unknown candidate id ${id}; do not invent candidates.`);
        structurallyValid = false;
      } else if (decided.has(id)) {
        issues.push(`Candidate ${id} is decided more than once; decide each candidate exactly once.`);
        structurallyValid = false;
      }
      decided.add(id);
    }
    if (raw.verdict === 'accepted' && ids.length !== 1) {
      issues.push(`${label} accepts ${ids.length} candidates; an accepted decision covers exactly one (use merged to combine).`);
      structurallyValid = false;
    }
    if (raw.verdict === 'merged' && ids.length < 2) {
      issues.push(`${label} merges fewer than two candidates; use accepted for a single candidate.`);
      structurallyValid = false;
    }
    if (!structurallyValid) return;

    if (raw.verdict === 'rejected' || raw.finding === null) {
      decisions.push({ candidateIds: ids, verdict: 'rejected', rationale: raw.rationale });

      return;
    }

    const sorted = [...ids].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
    const origins: ModelSelection[] = [];
    for (const id of sorted) {
      for (const origin of input.candidates[order.get(id) ?? 0]?.origins ?? []) {
        if (!origins.some((known) => sameModel(known, origin))) origins.push(origin);
      }
    }

    const normalized = input.normalizer.normalizeVerifiedFinding({
      id: raw.verdict === 'accepted' ? (ids[0] as string) : stableUuid(`merged\u0000${[...ids].sort().join(',')}`),
      origins,
      output: raw.finding,
      workspaceRoot: input.workspaceRoot,
    });
    if (!normalized.ok) {
      issues.push(`${label}: the finding was rejected (${normalized.reason}); use a repository-relative path inside the checkout and valid fields.`);

      return;
    }

    const decision: VerifierDecision = {
      candidateIds: ids,
      verdict: raw.verdict,
      rationale: raw.rationale,
      finding: normalized.finding,
    };
    decisions.push(decision);
    finalFindings.push({ id: normalized.finding.id, finding: normalized.finding, decision });
  });

  const omitted = input.candidates.filter((candidate) => !decided.has(candidate.id));
  if (omitted.length > 0) {
    const listed = omitted.slice(0, MAX_LISTED).map((candidate) => candidate.id).join(', ');
    const more = omitted.length > MAX_LISTED ? ` and ${omitted.length - MAX_LISTED} more` : '';
    issues.push(`Candidate(s) ${listed}${more} were omitted; every candidate must be decided exactly once.`);
  }
  if (issues.length > 0) return { ok: false, issues };

  const findings = finalFindings.map((entry) => entry.finding);
  const warnings = [...new Set([...input.jobWarnings, ...input.output.warnings])].slice(0, 100);
  const candidateCount = (verdict: VerifierDecision['verdict']) =>
    decisions.filter((decision) => decision.verdict === verdict).reduce((total, decision) => total + decision.candidateIds.length, 0);

  const parsed = VerifiedReportSchema.safeParse({
    reviewId: input.reviewId,
    executiveSummary: input.output.summary,
    overallRisk: SEVERITY_ORDER.find((severity) => findings.some((finding) => finding.severity === severity)) ?? 'clean',
    findings,
    decisions,
    acceptedCount: candidateCount('accepted'),
    rejectedCount: candidateCount('rejected'),
    mergedCount: candidateCount('merged'),
    warnings,
    exclusions: input.exclusions.slice(0, 1_000),
  });
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.slice(0, MAX_LISTED).map((issue) => `${issue.path.join('.') || 'report'}: ${issue.message}`) };
  }

  return { ok: true, report: parsed.data, finalFindings };
}
