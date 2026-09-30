import type { ReviewFinding } from '@pr-orchestrator/contracts';

import { REJECTION_TEXT, type CheckoutInspector, type InspectedFile } from './checkout-inspector.js';

/** Lines around the cited range in which a quoted excerpt may be found. */
export const EVIDENCE_LINE_TOLERANCE = 3;
/** How far (in lines) a verified finding may sit from a candidate in the same file without an explanation. */
export const RELOCATION_WINDOW = 15;
const MIN_EXCERPT_CHARACTERS = 4;
const REDACTED = '[REDACTED]';

type Located = Pick<ReviewFinding, 'filePath' | 'location'>;

export type LocationCheck = { ok: true; file: InspectedFile } | { ok: false; issue: string };

const rangeText = (finding: Located) =>
  `${finding.filePath}:${finding.location.startLine}${
    finding.location.endLine !== undefined && finding.location.endLine !== finding.location.startLine
      ? `-${finding.location.endLine}`
      : ''
  }`;

/**
 * Objective location check against the immutable checkout: the file exists,
 * is an inspectable regular file inside the checkout, is not excluded from
 * inspection, and the cited line range exists in it.
 */
export async function checkFindingLocation(
  finding: Located,
  inspector: CheckoutInspector,
  excludedPaths: ReadonlySet<string>,
): Promise<LocationCheck> {
  if (excludedPaths.has(finding.filePath)) {
    return { ok: false, issue: `${finding.filePath} is excluded from detailed inspection` };
  }
  const outcome = await inspector.inspect(finding.filePath);
  if (!outcome.ok) return { ok: false, issue: `${finding.filePath} ${REJECTION_TEXT[outcome.reason]}` };

  const lineCount = outcome.file.lines.length;
  const end = finding.location.endLine ?? finding.location.startLine;
  if (finding.location.startLine > lineCount || end > lineCount) {
    return { ok: false, issue: `${rangeText(finding)} is outside the file, which has ${lineCount} line(s)` };
  }

  return { ok: true, file: outcome.file };
}

const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();

/** Code excerpts quoted in backticks: fenced blocks and inline spans, one entry per non-trivial line. */
export function codeExcerpts(evidence: string): string[] {
  const excerpts: string[] = [];
  const withoutFences = evidence.replace(/```[^\n]*\n([\s\S]*?)```/gu, (_match, body: string) => {
    excerpts.push(...body.split(/\r\n|\n|\r/u));

    return ' ';
  });
  for (const match of withoutFences.matchAll(/`([^`\n]+)`/gu)) excerpts.push(match[1] as string);

  return excerpts
    .map(normalize)
    .filter((line) => line.split(REDACTED).join('').replace(/\s/gu, '').length >= MIN_EXCERPT_CHARACTERS);
}

/** True when `line` contains every fragment of the excerpt, in order; `[REDACTED]` matches anything. */
function lineContains(line: string, excerpt: string): boolean {
  let from = 0;
  for (const fragment of excerpt.split(REDACTED).map((part) => part.trim())) {
    if (fragment.length === 0) continue;
    const index = line.indexOf(fragment, from);
    if (index === -1) return false;
    from = index + fragment.length;
  }

  return true;
}

/**
 * Finds a quoted excerpt of the evidence in the cited lines (± tolerance).
 * Returns the matching line number, or null when the evidence quotes nothing
 * that is actually there. This proves the quoted code exists at the cited
 * location; it does not prove the claim about that code is correct.
 */
export function findEvidenceAnchor(finding: Located & Pick<ReviewFinding, 'evidence'>, file: InspectedFile): number | null {
  const excerpts = codeExcerpts(finding.evidence);
  const first = Math.max(1, finding.location.startLine - EVIDENCE_LINE_TOLERANCE);
  const last = Math.min(file.lines.length, (finding.location.endLine ?? finding.location.startLine) + EVIDENCE_LINE_TOLERANCE);

  for (let lineNumber = first; lineNumber <= last; lineNumber += 1) {
    const line = normalize(file.lines[lineNumber - 1] ?? '');
    if (excerpts.some((excerpt) => lineContains(line, excerpt))) return lineNumber;
  }

  return null;
}

/** Distance in lines between two ranges; 0 when they overlap. */
function gap(left: Located['location'], right: Located['location']): number {
  const leftEnd = left.endLine ?? left.startLine;
  const rightEnd = right.endLine ?? right.startLine;
  if (leftEnd < right.startLine) return right.startLine - leftEnd;
  if (rightEnd < left.startLine) return left.startLine - rightEnd;

  return 0;
}

/** Whether the final location stays with (or near) at least one referenced candidate. */
export function isNearCandidates(final: Located, candidates: readonly Located[]): boolean {
  return candidates.some(
    (candidate) => candidate.filePath === final.filePath && gap(candidate.location, final.location) <= RELOCATION_WINDOW,
  );
}

export { rangeText };
