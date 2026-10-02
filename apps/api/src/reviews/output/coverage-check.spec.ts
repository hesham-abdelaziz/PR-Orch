import { describe, expect, it } from 'vitest';

import { reviewAreas } from '../prompts/review-protocol.js';
import { coverageLogLine, coverageWarning, summarizeCoverage } from './coverage-check.js';
import type { CoverageOutput } from './review-output.schemas.js';

const areas = reviewAreas(['Routing']);
const entry = (area: string, status: CoverageOutput['status'] = 'checked'): CoverageOutput => ({
  area,
  status,
  note: `Looked at ${area}.`,
});

describe('summarizeCoverage', () => {
  it('reports complete coverage when every area has an entry', () => {
    const summary = summarizeCoverage(
      areas,
      areas.map((area) => entry(area.id, area.id === 'user-facing' ? 'not_applicable' : 'checked')),
    );

    expect(summary.missing).toEqual([]);
    expect(summary.notApplicable.map((area) => area.id)).toEqual(['user-facing']);
    expect(summary.checked).toHaveLength(areas.length - 1);
    expect(coverageWarning('codex/x', summary, areas.length)).toBeNull();
  });

  it('lists missing areas in protocol order and ignores unknown ids', () => {
    const summary = summarizeCoverage(areas, [entry('correctness'), entry('made-up'), entry('made-up')]);

    expect(summary.missing.map((area) => area.id)).toEqual(
      areas.map((area) => area.id).filter((id) => id !== 'correctness'),
    );
    expect(summary.unknown).toEqual(['made-up']);
  });

  it('matches ids case-insensitively and keeps the first entry per area', () => {
    const summary = summarizeCoverage(areas, [entry('SECURITY', 'not_applicable'), entry('security', 'checked')]);

    expect(summary.notApplicable.map((area) => area.id)).toEqual(['security']);
    expect(summary.checked).toEqual([]);
  });
});

describe('coverageWarning', () => {
  it('names the reviewer, the count, and a bounded list of titles', () => {
    const warning = coverageWarning('gemini/pro', summarizeCoverage(areas, []), areas.length);

    expect(warning).toMatch(/^Reviewer gemini\/pro did not report coverage for 12 of 12 review areas \(Intent and scope, /u);
    expect(warning).toMatch(/and 4 more\); treat them as not reviewed/u);
  });
});

describe('coverageLogLine', () => {
  it('summarizes counts and ids without model text', () => {
    const line = coverageLogLine(summarizeCoverage(areas, [entry('tests', 'not_applicable'), entry('ignore me')]));

    expect(line).toMatch(/^coverage: 0 checked, 1 not applicable, 11 missing/u);
    expect(line).toContain('not_applicable=[tests]');
    expect(line).toContain('unknown=1');
    expect(line).not.toContain('ignore me');
  });
});
