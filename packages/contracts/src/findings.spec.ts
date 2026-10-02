import { describe, expect, it } from 'vitest';

import {
  ReviewAreaCoverageSchema,
  ReviewAreaSourceSchema,
  ReviewAreaStatusSchema,
  ReviewerCoverageSchema,
  ReviewerResultSchema,
  ReviewFindingSchema,
  FindingProbeSchema,
  VerifierDecisionSchema,
  VerifiedReportSchema,
  type ReviewAreaCoverage,
  type ReviewerCoverage,
  type FindingProbe,
} from './index.js';

const reviewer = { provider: 'codex', model: 'gpt-codex' } as const;
const area = {
  area: 'security',
  title: 'Security',
  source: 'protocol',
  status: 'checked',
} as const;
const result = { reviewer, findings: [], warnings: [], exclusions: [] };
const report = {
  reviewId: '2f5b02de-54d7-4e45-9227-684754f40ee8',
  executiveSummary: 'No issues found.',
  overallRisk: 'clean',
  findings: [],
  decisions: [],
  acceptedCount: 0,
  rejectedCount: 0,
  mergedCount: 0,
  warnings: [],
  exclusions: [],
};

describe('review coverage contracts', () => {
  it.each([undefined, 'Checked authorization boundaries.'])(
    'accepts coverage with note %j',
    (note) => {
      const entry = note === undefined ? area : { ...area, note };
      const parsed: ReviewAreaCoverage = ReviewAreaCoverageSchema.parse(entry);
      expect(parsed).toEqual(entry);
    },
  );

  it('accepts all sources and statuses', () => {
    for (const source of ['protocol', 'standards']) {
      expect(ReviewAreaSourceSchema.parse(source)).toBe(source);
      for (const status of ['checked', 'not_applicable', 'missing']) {
        expect(ReviewAreaStatusSchema.parse(status)).toBe(status);
        expect(ReviewAreaCoverageSchema.parse({ ...area, source, status })).toEqual({
          ...area, source, status,
        });
      }
    }
  });

  it.each([
    { status: 'unknown' },
    { source: 'unknown' },
    { area: '' },
    { area: '   ' },
    { title: '' },
    { title: '   ' },
    { note: '' },
    { note: '   ' },
    { extra: true },
    { area: 'a'.repeat(101) },
    { title: 't'.repeat(201) },
    { note: 'n'.repeat(501) },
  ])('rejects invalid coverage entry %j', (patch) => {
    expect(ReviewAreaCoverageSchema.safeParse({ ...area, ...patch }).success).toBe(false);
  });

  it('trims coverage text and accepts text length limits', () => {
    expect(ReviewAreaCoverageSchema.parse({
      ...area, area: ' security ', title: ' Security ', note: ' Checked. ',
    })).toEqual({ ...area, note: 'Checked.' });
    expect(ReviewAreaCoverageSchema.safeParse({
      ...area, area: 'a'.repeat(100), title: 't'.repeat(200), note: 'n'.repeat(500),
    }).success).toBe(true);
  });

  it('parses legacy reviewer results and reports without coverage', () => {
    expect(ReviewerResultSchema.parse(result)).toEqual(result);
    expect(VerifiedReportSchema.parse(report)).toEqual(report);
  });

  it('preserves coverage in reviewer results and reports in reviewer order', () => {
    const coverage: ReviewerCoverage = ReviewerCoverageSchema.parse({ reviewer, areas: [area] });
    const second = { reviewer: { provider: 'claude', model: 'sonnet' }, areas: [] };
    expect(ReviewerResultSchema.parse({ ...result, coverage: [area] }).coverage).toEqual([area]);
    expect(VerifiedReportSchema.parse({ ...report, coverage: [coverage, second] }).coverage)
      .toEqual([coverage, second]);
  });

  it('rejects extra keys and invalid reviewers in reviewer coverage', () => {
    expect(ReviewerCoverageSchema.safeParse({ reviewer, areas: [area], extra: true }).success)
      .toBe(false);
    expect(ReviewerCoverageSchema.safeParse({
      reviewer: { provider: 'unknown', model: 'model' }, areas: [area],
    }).success).toBe(false);
  });

  it('bounds area lists to 200 and report coverage to 10 reviewers', () => {
    const areas = Array.from({ length: 200 }, () => area);
    const coverage = { reviewer, areas };
    expect(ReviewerCoverageSchema.safeParse(coverage).success).toBe(true);
    expect(ReviewerResultSchema.safeParse({ ...result, coverage: areas }).success).toBe(true);
    expect(ReviewerCoverageSchema.safeParse({ ...coverage, areas: [...areas, area] }).success)
      .toBe(false);
    expect(ReviewerResultSchema.safeParse({ ...result, coverage: [...areas, area] }).success)
      .toBe(false);
    const reviewers = Array.from({ length: 10 }, () => coverage);
    expect(VerifiedReportSchema.safeParse({ ...report, coverage: reviewers }).success).toBe(true);
    expect(VerifiedReportSchema.safeParse({ ...report, coverage: [...reviewers, coverage] }).success)
      .toBe(false);
  });
});

describe('finding probe contracts', () => {
  const finding = {
    id: '2f5b02de-54d7-4e45-9227-684754f40ee8', title: 'Null entry crashes mapper',
    severity: 'high', filePath: 'src/mapper.ts', location: { startLine: 1 },
    evidence: 'entry.value', impact: 'Mapping a null entry throws.',
    suggestedFix: 'Guard null entries.', origins: [reviewer],
  };
  const probe: FindingProbe = { summary: 'Null input throws.', script: 'map([null])', output: 'TypeError: null' };

  it('preserves probe evidence through reviewer results, verifier decisions and reports', () => {
    expect(FindingProbeSchema.parse(probe)).toEqual(probe);
    const withProbe = { ...finding, probe };
    const decision = { candidateIds: [finding.id], verdict: 'accepted', rationale: 'Confirmed.', finding: withProbe };
    expect(ReviewerResultSchema.parse({ ...result, findings: [withProbe] }).findings[0]?.probe).toEqual(probe);
    expect(VerifierDecisionSchema.parse(decision).finding?.probe).toEqual(probe);
    expect(VerifiedReportSchema.parse({ ...report, findings: [withProbe], decisions: [decision] }).findings[0]?.probe).toEqual(probe);
  });

  it.each([
    { summary: '' }, { summary: undefined }, { script: undefined }, { output: undefined },
    { script: '' }, { script: '   ' }, { output: '' }, { output: '   ' },
    { extra: true }, { summary: 's'.repeat(301) }, { script: 's'.repeat(4001) }, { output: 'o'.repeat(2001) },
  ])('rejects invalid probe %j', patch => {
    expect(ReviewFindingSchema.safeParse({ ...finding, probe: { ...probe, ...patch } }).success).toBe(false);
  });

  it('trims probe fields and accepts their maximum lengths', () => {
    expect(FindingProbeSchema.parse({ summary: ' Null input throws. ', script: ' map([null]) ', output: ' TypeError: null ' })).toEqual(probe);
    expect(FindingProbeSchema.safeParse({ summary: 's'.repeat(300), script: 's'.repeat(4000), output: 'o'.repeat(2000) }).success).toBe(true);
  });

  it('still parses stored findings, reviewer results and reports without a probe', () => {
    expect(ReviewFindingSchema.parse(finding)).toEqual(finding);
    expect(ReviewerResultSchema.parse({ ...result, findings: [finding] }).findings).toEqual([finding]);
    expect(VerifiedReportSchema.parse({ ...report, findings: [finding] }).findings).toEqual([finding]);
  });
});
