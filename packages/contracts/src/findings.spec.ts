import { describe, expect, it } from 'vitest';

import {
  ReviewAreaCoverageSchema,
  ReviewAreaSourceSchema,
  ReviewAreaStatusSchema,
  ReviewerCoverageSchema,
  ReviewerResultSchema,
  VerifiedReportSchema,
  type ReviewAreaCoverage,
  type ReviewerCoverage,
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
