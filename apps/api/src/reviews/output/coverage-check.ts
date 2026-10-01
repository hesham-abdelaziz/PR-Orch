import type { ReviewArea } from '../prompts/review-protocol.js';
import type { CoverageOutput } from './review-output.schemas.js';

export interface CoverageSummary {
  checked: ReviewArea[];
  notApplicable: ReviewArea[];
  /** Required areas the reviewer reported nothing for; treated as unreviewed. */
  missing: ReviewArea[];
  /** Area ids the reviewer reported that the job did not ask for. */
  unknown: string[];
}

/**
 * Compares a reviewer's coverage attestation with the job's required areas.
 * The first entry for an area wins; ids are compared case-insensitively.
 */
export function summarizeCoverage(
  required: readonly ReviewArea[],
  coverage: readonly CoverageOutput[],
): CoverageSummary {
  const byId = new Map<string, CoverageOutput>();
  const unknown: string[] = [];
  const known = new Set(required.map((area) => area.id.toLowerCase()));

  for (const entry of coverage) {
    const id = entry.area.trim().toLowerCase();
    if (!known.has(id)) {
      if (!unknown.includes(entry.area)) unknown.push(entry.area);
      continue;
    }
    if (!byId.has(id)) byId.set(id, entry);
  }

  const summary: CoverageSummary = { checked: [], notApplicable: [], missing: [], unknown };
  for (const area of required) {
    const entry = byId.get(area.id.toLowerCase());
    if (!entry) summary.missing.push(area);
    else if (entry.status === 'checked') summary.checked.push(area);
    else summary.notApplicable.push(area);
  }

  return summary;
}

const listTitles = (areas: readonly ReviewArea[], max: number): string => {
  const shown = areas.slice(0, max).map((area) => area.title);

  return areas.length > max ? `${shown.join(', ')}, and ${areas.length - max} more` : shown.join(', ');
};

/** Job warning for areas a reviewer left uncovered, or null when coverage is complete. */
export function coverageWarning(tag: string, summary: CoverageSummary, total: number): string | null {
  if (summary.missing.length === 0) return null;

  return `Reviewer ${tag} did not report coverage for ${summary.missing.length} of ${total} review areas (${listTitles(summary.missing, 8)}); treat them as not reviewed by this reviewer.`;
}

/** One bounded line for the run's sanitized log. */
export function coverageLogLine(summary: CoverageSummary): string {
  const ids = (areas: readonly ReviewArea[]) => areas.map((area) => area.id).join(',') || '-';

  return [
    `coverage: ${summary.checked.length} checked, ${summary.notApplicable.length} not applicable, ${summary.missing.length} missing`,
    `not_applicable=[${ids(summary.notApplicable)}]`,
    `missing=[${ids(summary.missing)}]`,
    ...(summary.unknown.length > 0 ? [`unknown=${summary.unknown.length}`] : []),
  ].join(' ');
}
