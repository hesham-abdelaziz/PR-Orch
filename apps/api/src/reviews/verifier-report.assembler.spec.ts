import { describe, expect, it } from 'vitest';

import { finding } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { InMemoryCheckout, syntheticSource } from '../../../../tests/fixtures/fake-clis/in-memory-checkout.js';
import { FindingNormalizerService } from './output/finding-normalizer.service.js';
import { VerifierOutputSchema, type VerifierOutput } from './output/review-output.schemas.js';
import { assembleVerifiedReport } from './verifier-report.assembler.js';

const normalizer = new FindingNormalizerService();
const codex = { provider: 'codex', model: 'cli-default' } as const;
const gemini = { provider: 'gemini', model: 'pro' } as const;
const a = finding({ id: '00000000-0000-4000-8000-00000000000a', severity: 'medium', origins: [codex] });
const b = finding({ id: '00000000-0000-4000-8000-00000000000b', severity: 'critical', origins: [gemini] });
const c = finding({ id: '00000000-0000-4000-8000-00000000000c', severity: 'low', origins: [gemini] });
const claude = { provider: 'claude', model: 'opus' } as const;
const checkout = new InMemoryCheckout({
  'src/loader.ts': syntheticSource(60),
  'src/helper.ts': syntheticSource(30),
  'package-lock.json': '{}',
});

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

type WireDecision = Omit<VerifierOutput['decisions'][number], 'locationCorrection'> & { locationCorrection?: string | null };

function assemble(decisions: WireDecision[], candidates = [a, b, c]) {
  return assembleVerifiedReport({
    reviewId: '00000000-0000-4000-8000-0000000000aa',
    output: {
      summary: 'Summary.',
      decisions: decisions.map((decision) => ({ locationCorrection: null, ...decision })),
      warnings: ['verifier note'],
    },
    candidates,
    workspaceRoot: '/work/job/checkout',
    jobWarnings: ['Reviewer gemini/pro timed out; results are partial.'],
    exclusions: [{ path: 'package-lock.json', reason: 'Lock file' }],
    normalizer,
    inspector: checkout.forCheckout('/work/job/checkout'),
  });
}

describe('assembleVerifiedReport', () => {
  it('accounts for every candidate exactly once and keeps the counts consistent', async () => {
    const outcome = await assemble([
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

  it('derives the merged finding id and origins from the candidates, independent of listing order', async () => {
    const forward = await assemble([
      { candidateIds: [a.id, b.id], verdict: 'merged', rationale: 'same', finding: wire(a) },
      { candidateIds: [c.id], verdict: 'rejected', rationale: 'no', finding: null },
    ]);
    const reversed = await assemble([
      { candidateIds: [b.id, a.id], verdict: 'merged', rationale: 'same', finding: wire(a) },
      { candidateIds: [c.id], verdict: 'rejected', rationale: 'no', finding: null },
    ]);

    if (!forward.ok || !reversed.ok) throw new Error('expected success');
    expect(forward.report.findings[0]?.id).toBe(reversed.report.findings[0]?.id);
    expect(forward.report.findings[0]?.id).not.toBe(a.id);
    expect(forward.report.findings[0]?.origins).toEqual([codex, gemini]);
    expect(reversed.report.findings[0]?.origins).toEqual([codex, gemini]);
  });

  it('keeps the candidate id for an accepted finding and never lets rejected ones become findings', async () => {
    const outcome = await assemble([
      { candidateIds: [a.id], verdict: 'accepted', rationale: 'ok', finding: wire(a) },
      { candidateIds: [b.id, c.id], verdict: 'rejected', rationale: 'not real', finding: null },
    ]);

    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.report.findings.map((entry) => entry.id)).toEqual([a.id]);
    expect(outcome.report.decisions[1]).toEqual({ candidateIds: [b.id, c.id], verdict: 'rejected', rationale: 'not real' });
    expect(outcome.report).toMatchObject({ rejectedCount: 2, overallRisk: 'medium' });
  });

  it('reports clean when everything is rejected', async () => {
    const outcome = await assemble([{ candidateIds: [a.id, b.id, c.id], verdict: 'rejected', rationale: 'no', finding: null }]);

    if (!outcome.ok) throw new Error('expected success');
    expect(outcome.report).toMatchObject({ overallRisk: 'clean', findings: [], rejectedCount: 3 });
  });

  it('lists every integrity problem for the correction prompt', async () => {
    const outcome = await assemble([
      { candidateIds: [a.id, a.id], verdict: 'rejected', rationale: 'dup', finding: null },
      { candidateIds: ['00000000-0000-4000-8000-00000000dead'], verdict: 'rejected', rationale: 'invented', finding: null },
    ]);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.join(' ')).toMatch(/repeats/u);
    expect(outcome.issues.join(' ')).toMatch(/unknown candidate id/u);
    expect(outcome.issues.join(' ')).toMatch(/omitted/u);
  });

  describe('objective evidence and location checks', () => {
    const issuesOf = async (decisions: WireDecision[]) => {
      const outcome = await assemble(decisions, [a]);
      if (outcome.ok) throw new Error('expected integrity issues');

      return outcome.issues.join(' ');
    };

    it('rejects a finding in a file that does not exist', async () => {
      expect(await issuesOf([{ candidateIds: [a.id], verdict: 'accepted', rationale: 'ok', finding: { ...wire(a), filePath: 'src/imaginary.ts' } }])).toMatch(
        /src\/imaginary\.ts does not exist in the checkout/u,
      );
    });

    it('rejects a line range beyond the end of the file', async () => {
      expect(
        await issuesOf([{ candidateIds: [a.id], verdict: 'accepted', rationale: 'ok', finding: { ...wire(a), location: { startLine: 58, endLine: 75, description: null } } }]),
      ).toMatch(/src\/loader\.ts:58-75 is outside the file, which has 60 line/u);
    });

    it('rejects a finding in a file excluded from inspection', async () => {
      expect(
        await issuesOf([{ candidateIds: [a.id], verdict: 'accepted', rationale: 'ok', finding: { ...wire(a), filePath: 'package-lock.json', location: { startLine: 1, endLine: null, description: null } } }]),
      ).toMatch(/excluded from detailed inspection/u);
    });

    it('rejects a claim moved to an unrelated location without an explanation', async () => {
      const moved = {
        ...wire(a),
        title: 'SQL injection in the helper',
        filePath: 'src/helper.ts',
        location: { startLine: 20, endLine: null, description: null },
        evidence: 'Builds `compute(20)` from input.',
      };

      expect(await issuesOf([{ candidateIds: [a.id], verdict: 'accepted', rationale: 'ok', finding: moved }])).toMatch(
        /moves the finding to src\/helper\.ts:20, away from its candidates \(src\/loader\.ts:12-14\)/u,
      );
    });

    it.each([
      ['evidence that quotes no code', 'Line 12 reads config.value without a null check.'],
      ['evidence quoting code that is not at the cited lines', 'Reads `config.other.value` unguarded.'],
    ])('rejects %s', async (_name, evidence) => {
      expect(await issuesOf([{ candidateIds: [a.id], verdict: 'accepted', rationale: 'ok', finding: { ...wire(a), evidence } }])).toMatch(
        /evidence must quote, in backticks, code that appears at src\/loader\.ts:12-14/u,
      );
    });

    it('accepts a legitimate correction: new wording, adjusted severity and a nearby line fix', async () => {
      const outcome = await assemble(
        [
          {
            candidateIds: [a.id],
            verdict: 'accepted',
            rationale: 'Real, but only reachable with an empty file; the dereference is on line 12, not 13.',
            finding: {
              ...wire(a),
              title: 'Loader dereferences config.value before validating it',
              severity: 'low',
              location: { startLine: 12, endLine: null, description: null },
              evidence: 'Line 12 is `const port = config.value.port;` with no guard.',
            },
          },
        ],
        [a],
      );

      if (!outcome.ok) throw new Error(outcome.issues.join('; '));
      expect(outcome.report.findings[0]).toMatchObject({ id: a.id, severity: 'low', origins: [codex] });
      expect(outcome.finalFindings[0]?.verification).toEqual({
        candidates: [{ id: a.id, title: a.title, severity: 'medium', filePath: 'src/loader.ts', startLine: 12, endLine: 14 }],
        relocated: false,
        locationCorrection: null,
        evidenceLine: 12,
        severityChanged: true,
      });
    });

    it('accepts a cross-file correction that is explained and supported by quoted code there', async () => {
      const outcome = await assemble(
        [
          {
            candidateIds: [a.id],
            verdict: 'accepted',
            rationale: 'The unchecked read is in the helper the loader calls.',
            locationCorrection: 'The loader only forwards config; the unchecked dereference is in helper.ts.',
            finding: { ...wire(a), filePath: 'src/helper.ts', location: { startLine: 12, endLine: null, description: null }, evidence: '`config.value.port` is read unguarded.' },
          },
        ],
        [a],
      );

      if (!outcome.ok) throw new Error(outcome.issues.join('; '));
      expect(outcome.finalFindings[0]?.verification).toMatchObject({
        relocated: true,
        locationCorrection: 'The loader only forwards config; the unchecked dereference is in helper.ts.',
        evidenceLine: 12,
      });
    });

    it('still requires quoted evidence at the new location of an explained correction', async () => {
      expect(
        await issuesOf([
          {
            candidateIds: [a.id],
            verdict: 'accepted',
            rationale: 'moved',
            locationCorrection: 'It is really in the helper.',
            finding: { ...wire(a), filePath: 'src/helper.ts', location: { startLine: 3, endLine: null, description: null }, evidence: 'Reads `config.value.port`.' },
          },
        ]),
      ).toMatch(/evidence must quote/u);
    });

    it('merges duplicates with origins taken only from the merged candidates', async () => {
      const other = finding({ id: '00000000-0000-4000-8000-0000000000dd', severity: 'high', origins: [claude] });
      const outcome = await assemble(
        [
          { candidateIds: [b.id, a.id], verdict: 'merged', rationale: 'Same defect.', finding: { ...wire(b), location: { startLine: 13, endLine: null, description: null } } },
          { candidateIds: [other.id], verdict: 'rejected', rationale: 'Not reproducible.', finding: null },
        ],
        [a, b, other],
      );

      if (!outcome.ok) throw new Error(outcome.issues.join('; '));
      expect(outcome.report.findings[0]?.origins).toEqual([codex, gemini]);
      expect(outcome.finalFindings[0]?.verification.candidates.map((entry) => entry.id)).toEqual([a.id, b.id]);
    });

    it('cannot be given origins by the model: the wire schema refuses them', () => {
      const parsed = VerifierOutputSchema.safeParse({
        summary: 's',
        warnings: [],
        decisions: [{ candidateIds: [a.id], verdict: 'accepted', rationale: 'r', locationCorrection: null, finding: { ...wire(a), origins: [claude] } }],
      });

      expect(parsed.success).toBe(false);
    });
  });
});

