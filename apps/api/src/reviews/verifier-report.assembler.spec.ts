import { describe, expect, it } from 'vitest';

import { finding } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { FindingNormalizerService } from './output/finding-normalizer.service.js';
import type { VerifierOutput } from './output/review-output.schemas.js';
import { assembleVerifiedReport } from './verifier-report.assembler.js';

const normalizer = new FindingNormalizerService();
const codex = { provider: 'codex', model: 'cli-default' } as const;
const gemini = { provider: 'gemini', model: 'pro' } as const;
const a = finding({ id: '00000000-0000-4000-8000-00000000000a', severity: 'medium', origins: [codex] });
const b = finding({ id: '00000000-0000-4000-8000-00000000000b', severity: 'critical', origins: [gemini] });
const c = finding({ id: '00000000-0000-4000-8000-00000000000c', severity: 'low', origins: [gemini] });

const wire = (source: typeof a): NonNullable<VerifierOutput['decisions'][number]['finding']> => ({
  title: source.title,
  severity: source.severity,
  filePath: source.filePath,
  location: { startLine: source.location.startLine, endLine: source.location.endLine ?? null, description: null },
  evidence: source.evidence,
  impact: source.impact,
  suggestedFix: source.suggestedFix,
  reference: null,
});

function assemble(decisions: VerifierOutput['decisions']) {
  return assembleVerifiedReport({
    reviewId: '00000000-0000-4000-8000-0000000000aa',
    output: { summary: 'Summary.', decisions, warnings: ['verifier note'] },
    candidates: [a, b, c],
    workspaceRoot: '/work/job/checkout',
    jobWarnings: ['Reviewer gemini/pro timed out; results are partial.'],
    exclusions: [{ path: 'package-lock.json', reason: 'Lock file' }],
    normalizer,
  });
}

describe('assembleVerifiedReport', () => {
  it('accounts for every candidate exactly once and keeps the counts consistent', () => {
    const outcome = assemble([
      { candidateIds: [a.id], verdict: 'accepted', rationale: 'ok', finding: wire(a) },
      { candidateIds: [c.id, b.id], verdict: 'merged', rationale: 'same', finding: wire(b) },
    ]);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { report } = outcome;
    expect(report.acceptedCount + report.rejectedCount + report.mergedCount).toBe(3);
    expect(report).toMatchObject({ acceptedCount: 1, mergedCount: 2, rejectedCount: 0, overallRisk: 'critical' });
    expect(report.warnings).toEqual(['Reviewer gemini/pro timed out; results are partial.', 'verifier note']);
    expect(outcome.finalFindings).toHaveLength(2);
  });

  it('derives the merged finding id and origins from the candidates, independent of listing order', () => {
    const forward = assemble([
      { candidateIds: [a.id, b.id], verdict: 'merged', rationale: 'same', finding: wire(a) },
      { candidateIds: [c.id], verdict: 'rejected', rationale: 'no', finding: null },
    ]);
    const reversed = assemble([
      { candidateIds: [b.id, a.id], verdict: 'merged', rationale: 'same', finding: wire(a) },
      { candidateIds: [c.id], verdict: 'rejected', rationale: 'no', finding: null },
    ]);

    if (!forward.ok || !reversed.ok) throw new Error('expected success');
    expect(forward.report.findings[0]?.id).toBe(reversed.report.findings[0]?.id);
    expect(forward.report.findings[0]?.id).not.toBe(a.id);
    expect(forward.report.findings[0]?.origins).toEqual([codex, gemini]);
    expect(reversed.report.findings[0]?.origins).toEqual([codex, gemini]);
  });

  it('keeps the candidate id for an accepted finding and never lets rejected ones become findings', () => {
    const outcome = assemble([
      { candidateIds: [a.id], verdict: 'accepted', rationale: 'ok', finding: wire(a) },
      { candidateIds: [b.id, c.id], verdict: 'rejected', rationale: 'not real', finding: null },
    ]);

    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.report.findings.map((entry) => entry.id)).toEqual([a.id]);
    expect(outcome.report.decisions[1]).toEqual({ candidateIds: [b.id, c.id], verdict: 'rejected', rationale: 'not real' });
    expect(outcome.report).toMatchObject({ rejectedCount: 2, overallRisk: 'medium' });
  });

  it('reports clean when everything is rejected', () => {
    const outcome = assemble([{ candidateIds: [a.id, b.id, c.id], verdict: 'rejected', rationale: 'no', finding: null }]);

    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.report).toMatchObject({ overallRisk: 'clean', findings: [], rejectedCount: 3 });
  });

  it('lists every integrity problem for the correction prompt', () => {
    const outcome = assemble([
      { candidateIds: [a.id, a.id], verdict: 'rejected', rationale: 'dup', finding: null },
      { candidateIds: ['00000000-0000-4000-8000-00000000dead'], verdict: 'rejected', rationale: 'invented', finding: null },
    ]);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.join(' ')).toMatch(/repeats/u);
    expect(outcome.issues.join(' ')).toMatch(/unknown candidate id/u);
    expect(outcome.issues.join(' ')).toMatch(/omitted/u);
  });
});
