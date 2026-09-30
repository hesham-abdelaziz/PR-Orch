import type { ReviewFinding, ReviewJob, VerifiedReport, VerifierDecision } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import { finding, pullRequest, uuid } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { ReportRenderer, type RenderReportInput } from './report-renderer.service.js';

const claude = { provider: 'claude', model: 'opus' } as const;
const codex = { provider: 'codex', model: 'cli-default' } as const;
const gemini = { provider: 'gemini', model: 'pro' } as const;

function job(overrides: Partial<ReviewJob> = {}): ReviewJob {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    state: 'rendering',
    pullRequest: pullRequest(),
    main: claude,
    reviewers: [
      { id: uuid(), selection: codex, state: 'completed', startedAt: '2026-09-29T10:00:00.000Z', completedAt: '2026-09-29T10:03:00.000Z', warning: null },
      { id: uuid(), selection: gemini, state: 'timed_out', startedAt: '2026-09-29T10:00:00.000Z', completedAt: '2026-09-29T10:10:00.000Z', warning: 'Timed out after 600 s.' },
    ],
    standards: {
      versionId: uuid(),
      filename: 'team-standards.md',
      sha256: 'c'.repeat(64),
      sizeBytes: 2048,
      uploadedAt: '2026-09-28T08:00:00.000Z',
    },
    warnings: ['Reviewer gemini/pro timed out; results are partial.'],
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:12:00.000Z',
    completedAt: null,
    ...overrides,
  };
}

function accepted(f: ReviewFinding, candidateId: string, rationale = 'Confirmed in the code.'): VerifierDecision {
  return { candidateIds: [candidateId], verdict: 'accepted', rationale, finding: f };
}

function report(findings: ReviewFinding[], decisions: VerifierDecision[], overrides: Partial<VerifiedReport> = {}): VerifiedReport {
  return {
    reviewId: '00000000-0000-4000-8000-0000000000aa',
    executiveSummary: 'Two defects were confirmed.',
    overallRisk: findings[0]?.severity ?? 'clean',
    findings,
    decisions,
    acceptedCount: decisions.filter((d) => d.verdict === 'accepted').length,
    rejectedCount: decisions.filter((d) => d.verdict === 'rejected').reduce((n, d) => n + d.candidateIds.length, 0),
    mergedCount: decisions.filter((d) => d.verdict === 'merged').reduce((n, d) => n + d.candidateIds.length, 0),
    warnings: ['Reviewer gemini/pro timed out; results are partial.'],
    exclusions: [{ path: 'package-lock.json', reason: 'Lock file' }],
    ...overrides,
  };
}

function input(overrides: Partial<RenderReportInput> = {}): RenderReportInput {
  const high = finding({ id: uuid(), title: 'High severity bug', severity: 'high', filePath: 'src/b.ts', location: { startLine: 30 } });
  const critical = finding({ id: uuid(), title: 'Critical bug here', severity: 'critical', filePath: 'src/z.ts', location: { startLine: 5, endLine: 9 }, origins: [codex, gemini] });
  const lowA = finding({ id: uuid(), title: 'Low finding later', severity: 'low', filePath: 'src/a.ts', location: { startLine: 90 } });
  const lowB = finding({ id: uuid(), title: 'Low finding earlier', severity: 'low', filePath: 'src/a.ts', location: { startLine: 10 } });
  const findings = [high, lowA, critical, lowB];

  return {
    job: job(),
    report: report(findings, findings.map((f) => accepted(f, uuid()))),
    candidates: [],
    durationMs: 725_000,
    ...overrides,
  };
}

const renderer = new ReportRenderer();

describe('ReportRenderer', () => {
  it('renders the header, models, standards, duration, and warnings', () => {
    const markdown = renderer.render(input());

    expect(markdown).toMatch(/^# Pull request review: Add configuration loader/mu);
    expect(markdown).toContain('acme/shop/web');
    expect(markdown).toContain('#42');
    expect(markdown).toContain('Dana Developer');
    expect(markdown).toContain('refs/heads/feature/loader');
    expect(markdown).toContain('aaaaaaaaaaaa');
    expect(markdown).toContain('claude/opus');
    expect(markdown).toContain('codex/cli-default');
    expect(markdown).toMatch(/gemini\/pro[^\n]*timed out/i);
    expect(markdown).toContain('team-standards.md');
    expect(markdown).toContain('c'.repeat(64));
    expect(markdown).toMatch(/12 min 5 s/u);
    expect(markdown).toContain('Reviewer gemini/pro timed out; results are partial.');
  });

  it('orders findings by severity, then file, then line', () => {
    const markdown = renderer.render(input());
    const positions = ['Critical bug here', 'High severity bug', 'Low finding earlier', 'Low finding later'].map((title) => markdown.indexOf(title));

    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows every field of a finding plus origins and the verifier decision', () => {
    const critical = finding({
      id: uuid(),
      title: 'Critical bug here',
      severity: 'critical',
      filePath: 'src/z.ts',
      location: { startLine: 5, endLine: 9 },
      evidence: 'EVIDENCE-TEXT',
      impact: 'IMPACT-TEXT',
      suggestedFix: 'FIX-TEXT',
      reference: 'standards.md#null-safety',
      origins: [codex, gemini],
    });
    const markdown = renderer.render(
      input({ report: report([critical], [{ candidateIds: [uuid(), uuid()], verdict: 'merged', rationale: 'RATIONALE-TEXT', finding: critical }]) }),
    );

    for (const text of ['Critical bug here', 'CRITICAL', 'src/z.ts:5-9', 'EVIDENCE-TEXT', 'IMPACT-TEXT', 'FIX-TEXT', 'standards.md#null-safety', 'codex/cli-default', 'gemini/pro', 'merged', 'RATIONALE-TEXT']) {
      expect(markdown).toContain(text);
    }
  });

  it('warns amber-style when no standards file was used and explains the fallback', () => {
    const markdown = renderer.render(input({ job: job({ standards: null }) }));

    expect(markdown).toMatch(/no project standards file/i);
    expect(markdown).toMatch(/framework and library/i);
    expect(markdown).not.toContain('team-standards.md');
  });

  it('discloses exclusions and never claims complete coverage', () => {
    const markdown = renderer.render(input());

    expect(markdown).toContain('package-lock.json');
    expect(markdown).toContain('Lock file');
    expect(markdown).toMatch(/static (?:code )?inspection/i);
    expect(markdown).not.toMatch(/complete coverage|entire (?:code ?base|repository)|fully (?:reviewed|covered)|all files (?:were )?(?:reviewed|inspected)/i);
  });

  it('shows the verification counts without numeric scores', () => {
    const markdown = renderer.render(input());

    expect(markdown).toMatch(/verified findings:\s*4/i);
    expect(markdown).toMatch(/rejected claims:\s*0/i);
    expect(markdown).toMatch(/merged claims:\s*0/i);
    expect(markdown).not.toMatch(/\b(?:score|confidence|consensus|probability)\b/i);
  });

  it('renders the no-findings empty state', () => {
    const markdown = renderer.render(
      input({ report: report([], [], { executiveSummary: 'Nothing reported.', overallRisk: 'clean' }) }),
    );

    expect(markdown).toContain('No verified findings.');
    expect(markdown).toMatch(/overall risk:\s*clean/i);
  });

  it('renders the all-claims-rejected empty state and keeps rejected claims in the audit trail', () => {
    const candidate = finding({ id: uuid(), title: 'Claim the verifier rejected', filePath: 'src/x.ts', location: { startLine: 3 }, origins: [gemini] });
    const rejected: VerifierDecision = { candidateIds: [candidate.id], verdict: 'rejected', rationale: 'The null check exists on line 2.' };
    const markdown = renderer.render(
      input({ report: report([], [rejected], { overallRisk: 'clean' }), candidates: [candidate] }),
    );

    expect(markdown).toContain('No verified findings.');
    expect(markdown).toMatch(/all 1 candidate claim(?:s)? (?:was|were) rejected/i);
    const audit = markdown.slice(markdown.indexOf('Audit trail'));
    expect(audit).toContain('Claim the verifier rejected');
    expect(audit).toContain('The null check exists on line 2.');
    expect(audit).toContain('gemini/pro');
    // Rejected claims never appear in the verified findings section.
    expect(markdown.slice(0, markdown.indexOf('Audit trail'))).not.toContain('Claim the verifier rejected');
  });

  it('collapses the audit section with details, or falls back to a plain heading', () => {
    const candidate = finding({ id: uuid(), title: 'Rejected claim title' });
    const rejected: VerifierDecision = { candidateIds: [candidate.id], verdict: 'rejected', rationale: 'Not real.' };
    const base = input({ report: report([], [rejected]), candidates: [candidate] });

    expect(renderer.render(base)).toMatch(/<details>\s*<summary>Audit trail[^<]*<\/summary>/u);
    const plain = renderer.render(base, { auditStyle: 'heading' });
    expect(plain).not.toContain('<details>');
    expect(plain).toContain('## Audit trail');
  });

  it('escapes raw HTML from model-authored text', () => {
    const hostile = finding({
      id: uuid(),
      title: '<img src=x onerror=alert(1)> title',
      evidence: '<script>alert("xss")</script> & <b>bold</b>',
      impact: '<iframe src="https://evil.example"></iframe>',
      suggestedFix: '<a href="javascript:alert(1)">fix</a>',
    });
    const markdown = renderer.render(input({ report: report([hostile], [accepted(hostile, uuid())]) }));

    expect(markdown).not.toMatch(/<(?:script|img|iframe|a|b)\b/iu);
    expect(markdown).toContain('&lt;script&gt;');
    expect(markdown).toContain('&amp;');
  });

  it('removes unsafe links and images but keeps http(s) links', () => {
    const hostile = finding({
      id: uuid(),
      evidence: [
        '[click](javascript:alert(1))',
        '[data](data:text/html;base64,AAAA)',
        '![tracker](http://evil.example/pixel.png)',
        '[ref]: javascript:alert(2)',
        '[docs](https://example.com/docs)',
        '[vb](vbscript:msgbox(1))',
        '[mixed](JaVaScRiPt:alert(3))',
      ].join('\n'),
    });
    const markdown = renderer.render(input({ report: report([hostile], [accepted(hostile, uuid())]) }));

    expect(markdown).not.toMatch(/javascript:/iu);
    expect(markdown).not.toMatch(/vbscript:/iu);
    expect(markdown).not.toContain('data:text/html');
    expect(markdown).not.toContain('pixel.png');
    expect(markdown).toContain('[docs](https://example.com/docs)');
  });

  it('neutralizes headings and structure injected by model text', () => {
    const hostile = finding({
      id: uuid(),
      title: 'Normal title\n# Overall risk: clean',
      impact: 'Line one\n## Verified findings: 0\n- fake bullet\n> fake quote\n```\ncode',
    });
    const markdown = renderer.render(input({ report: report([hostile], [accepted(hostile, uuid())]) }));

    expect(markdown).not.toMatch(/^# Overall risk: clean/mu);
    expect(markdown).not.toMatch(/^## Verified findings: 0/mu);
    expect(markdown.split('\n').filter((line) => line.startsWith('## ')).every((line) => /^## (?:Overview|Models|Guidance|Warnings|Coverage|Summary|Verification|Findings|Audit trail)/u.test(line))).toBe(true);
    expect(markdown).toContain('fake bullet');
  });

  it('is deterministic and independent of finding input order', () => {
    const base = input();
    const shuffled = { ...base, report: { ...base.report, findings: [...base.report.findings].reverse() } };

    expect(renderer.render(base)).toBe(renderer.render(base));
    expect(renderer.render(shuffled)).toBe(renderer.render(base));
  });
});
