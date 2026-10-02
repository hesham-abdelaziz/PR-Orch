import {
  VerifiedReportSchema,
  type ModelSelection,
  type ReviewFinding,
  type Severity,
  type VerifiedReport,
  type VerifierDecision,
} from '@pr-orchestrator/contracts';

import type { CoverageExclusion } from './entities/review-job.entity.js';
import type { FinalFindingRecord, FindingVerificationAudit } from './entities/final-finding.entity.js';
import type { CheckoutInspector } from './output/checkout-inspector.js';
import {
  checkFindingLocation,
  findEvidenceAnchor,
  isNearCandidates,
  rangeText,
} from './output/finding-evidence.validator.js';
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
  /** Read-only view of the immutable prepared checkout. */
  inspector: CheckoutInspector;
  /**
   * Paths the workspace excluded from detailed inspection (trusted metadata).
   * Defaults to the paths in `exclusions`.
   */
  excludedPaths?: ReadonlySet<string>;
}

export type AssembledFinding = Pick<FinalFindingRecord, 'id' | 'finding' | 'decision' | 'verification'>;

export type AssembleOutcome =
  | { ok: true; report: VerifiedReport; finalFindings: AssembledFinding[] }
  | { ok: false; issues: string[] };

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
const MAX_LISTED = 10;

const sameModel = (left: ModelSelection, right: ModelSelection) =>
  left.provider === right.provider && left.model === right.model;

/**
 * Turns validated verifier output into the canonical report, enforcing the
 * verifier contract with checks the engine can decide on its own:
 *
 * - every candidate is decided exactly once, nothing is invented, and finding
 *   identity and origins are derived from the referenced candidates only;
 * - each accepted or merged finding cites an inspectable file of the checkout
 *   and a line range that exists in it;
 * - its evidence quotes (in backticks) code that is actually at those lines;
 * - it stays at or near a referenced candidate's location unless the verifier
 *   explains the correction in `locationCorrection`.
 *
 * Wording and severity may change freely. Whether the claim about the quoted
 * code is *true* remains the verifier model's judgment; that is recorded in the
 * audit, not proven here.
 */
export async function assembleVerifiedReport(input: AssembleInput): Promise<AssembleOutcome> {
  const issues: string[] = [];
  const order = new Map(input.candidates.map((candidate, index) => [candidate.id, index]));
  const excludedPaths = input.excludedPaths ?? new Set(input.exclusions.map((exclusion) => exclusion.path));
  const decided = new Set<string>();
  const decisions: VerifierDecision[] = [];
  const finalFindings: AssembledFinding[] = [];

  for (const [index, raw] of input.output.decisions.entries()) {
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
    if (!structurallyValid) continue;

    if (raw.verdict === 'rejected' || raw.finding === null) {
      decisions.push({ candidateIds: ids, verdict: 'rejected', rationale: raw.rationale });
      continue;
    }

    const referenced = [...ids]
      .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0))
      .map((id) => input.candidates[order.get(id) ?? 0] as ReviewFinding);
    const origins: ModelSelection[] = [];
    for (const candidate of referenced) {
      for (const origin of candidate.origins) {
        if (!origins.some((known) => sameModel(known, origin))) origins.push(origin);
      }
    }

    let probe: ReviewFinding['probe'];
    if (raw.probeFromCandidate !== null) {
      const source = referenced.find((candidate) => candidate.id === raw.probeFromCandidate);
      if (source === undefined) {
        issues.push(`${label}: probeFromCandidate must be one of the candidate ids this decision covers, or null.`);
        continue;
      }
      if (source.probe === undefined) {
        issues.push(`${label}: candidate ${source.id} has no probe; set probeFromCandidate to null or to a candidate that has one.`);
        continue;
      }
      probe = source.probe;
    }

    const normalized = input.normalizer.normalizeVerifiedFinding({
      id: raw.verdict === 'accepted' ? (ids[0] as string) : stableUuid(`merged\u0000${[...ids].sort().join(',')}`),
      origins,
      ...(probe === undefined ? {} : { probe }),
      output: raw.finding,
      workspaceRoot: input.workspaceRoot,
    });
    if (!normalized.ok) {
      issues.push(`${label}: the finding was rejected (${normalized.reason}); use a repository-relative path inside the checkout and valid fields.`);
      continue;
    }
    const finding = normalized.finding;

    const location = await checkFindingLocation(finding, input.inspector, excludedPaths);
    if (!location.ok) {
      issues.push(`${label}: ${location.issue}; cite an existing, inspectable file and line range of the checkout.`);
      continue;
    }

    const evidenceLine = findEvidenceAnchor(finding, location.file);
    if (evidenceLine === null) {
      issues.push(
        `${label}: the evidence must quote, in backticks, code that appears at ${rangeText(finding)}; none of its quoted excerpts was found there.`,
      );
    }

    const relocated = !isNearCandidates(finding, referenced);
    if (relocated && raw.locationCorrection === null) {
      issues.push(
        `${label} moves the finding to ${rangeText(finding)}, away from its candidates (${referenced.map(rangeText).join(', ')}); keep it at a candidate location or explain the correction in locationCorrection.`,
      );
    }
    if (evidenceLine === null || (relocated && raw.locationCorrection === null)) continue;

    const verification: FindingVerificationAudit = {
      candidates: referenced.map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        severity: candidate.severity,
        filePath: candidate.filePath,
        startLine: candidate.location.startLine,
        endLine: candidate.location.endLine ?? null,
      })),
      relocated,
      locationCorrection: relocated ? raw.locationCorrection : null,
      evidenceLine,
      severityChanged: !referenced.some((candidate) => candidate.severity === finding.severity),
    };
    const decision: VerifierDecision = { candidateIds: ids, verdict: raw.verdict, rationale: raw.rationale, finding };
    decisions.push(decision);
    finalFindings.push({ id: finding.id, finding, decision, verification });
  }

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
