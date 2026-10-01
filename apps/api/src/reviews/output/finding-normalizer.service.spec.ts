import { ReviewerResultSchema, type ModelSelection } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import { FindingNormalizerService } from './finding-normalizer.service.js';
import type { ReviewerOutput } from './review-output.schemas.js';

const ROOT = 'C:\\work\\job-1\\checkout';
const claude: ModelSelection = { provider: 'claude', model: 'opus' };
const codex: ModelSelection = { provider: 'codex', model: 'cli-default' };

function finding(overrides: Partial<ReviewerOutput['findings'][number]> = {}) {
  return {
    title: 'Unchecked null dereference in loader',
    severity: 'high' as const,
    filePath: 'src/loader.ts',
    location: { startLine: 12, endLine: 14, description: null },
    evidence: 'Line 12 reads config.value without a null check.',
    impact: 'The loader throws for empty configuration.',
    suggestedFix: 'Guard config before reading value.',
    reference: null,
    ...overrides,
  };
}

function output(...findings: ReviewerOutput['findings']): ReviewerOutput {
  return { findings, warnings: [], exclusions: [], coverage: [] };
}

const service = new FindingNormalizerService();

describe('FindingNormalizerService', () => {
  it('assigns origin metadata and a stable uuid to every finding', () => {
    const { result, dropped } = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: output(finding()),
    });

    expect(dropped).toEqual([]);
    expect(() => ReviewerResultSchema.parse(result)).not.toThrow();
    expect(result.reviewer).toEqual(claude);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      title: 'Unchecked null dereference in loader',
      filePath: 'src/loader.ts',
      location: { startLine: 12, endLine: 14 },
      origins: [claude],
    });
    expect(result.findings[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('computes the same id for the same finding and different ids for different origins', () => {
    const first = service.normalizeReviewer({ reviewer: claude, workspaceRoot: ROOT, output: output(finding()) });
    const again = service.normalizeReviewer({ reviewer: claude, workspaceRoot: ROOT, output: output(finding()) });
    const other = service.normalizeReviewer({ reviewer: codex, workspaceRoot: ROOT, output: output(finding()) });

    expect(again.result.findings[0]?.id).toBe(first.result.findings[0]?.id);
    expect(other.result.findings[0]?.id).not.toBe(first.result.findings[0]?.id);
  });

  it('derives the id from path, location, and title but not from prose', () => {
    const base = service.normalizeReviewer({ reviewer: claude, workspaceRoot: ROOT, output: output(finding()) });
    const reworded = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: output(finding({ evidence: 'Reworded evidence.', impact: 'Reworded impact.' })),
    });
    const moved = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: output(finding({ location: { startLine: 99, endLine: null, description: null } })),
    });

    expect(reworded.result.findings[0]?.id).toBe(base.result.findings[0]?.id);
    expect(moved.result.findings[0]?.id).not.toBe(base.result.findings[0]?.id);
  });

  it('collapses duplicate candidates from the same reviewer', () => {
    const { result } = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: output(finding(), finding({ evidence: 'Second wording of the same claim.' }), finding({ filePath: 'src\\loader.ts' })),
    });

    expect(result.findings).toHaveLength(1);
  });

  it('normalizes path separators and absolute checkout paths', () => {
    const { result } = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: output(
        finding({ filePath: '.\\src\\a.ts', title: 'Finding A here' }),
        finding({ filePath: 'C:\\work\\job-1\\checkout\\src\\b.ts', title: 'Finding B here' }),
      ),
    });

    expect(result.findings.map((entry) => entry.filePath)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('drops findings whose paths escape the checkout and reports why', () => {
    const { result, dropped } = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: output(
        finding({ filePath: '../../secrets.txt', title: 'Traversal attempt one' }),
        finding({ filePath: 'C:\\Windows\\win.ini', title: 'Absolute outside root' }),
        finding({ filePath: 'https://evil.example/a.ts', title: 'Remote URL path' }),
        finding({ filePath: 'src/ok.ts', title: 'A legitimate finding' }),
      ),
    });

    expect(result.findings.map((entry) => entry.filePath)).toEqual(['src/ok.ts']);
    expect(dropped).toEqual([
      { title: 'Traversal attempt one', reason: 'traversal' },
      { title: 'Absolute outside root', reason: 'outside_checkout' },
      { title: 'Remote URL path', reason: 'invalid' },
    ]);
  });

  it('omits null optional fields so the contract schema accepts them', () => {
    const { result } = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: output(
        finding({
          location: { startLine: 3, endLine: null, description: 'inside the ctor' },
          reference: 'standards.md#null-safety',
        }),
      ),
    });

    expect(result.findings[0]?.location).toEqual({ startLine: 3, description: 'inside the ctor' });
    expect(result.findings[0]?.reference).toBe('standards.md#null-safety');
  });

  it('drops a finding whose location is inverted rather than guessing', () => {
    const { result, dropped } = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: output(finding({ location: { startLine: 20, endLine: 10, description: null } })),
    });

    expect(result.findings).toEqual([]);
    expect(dropped).toEqual([
      { title: 'Unchecked null dereference in loader', reason: 'invalid_finding' },
    ]);
  });

  it('carries reviewer warnings and normalized exclusions, dropping unsafe ones', () => {
    const { result, dropped } = service.normalizeReviewer({
      reviewer: claude,
      workspaceRoot: ROOT,
      output: {
        findings: [],
        coverage: [],
        warnings: ['Skipped generated code.'],
        exclusions: [
          { path: 'dist\\bundle.js', reason: 'Generated' },
          { path: '../outside', reason: 'Nope' },
        ],
      },
    });

    expect(result.warnings).toEqual(['Skipped generated code.']);
    expect(result.exclusions).toEqual([{ path: 'dist/bundle.js', reason: 'Generated' }]);
    expect(dropped).toEqual([{ title: '../outside', reason: 'traversal' }]);
  });

  describe('normalizeVerifiedFinding', () => {
    const id = '11111111-1111-4111-8111-111111111111';

    it('builds a contract-valid finding with the given id and origins, never model-supplied ones', () => {
      const outcome = service.normalizeVerifiedFinding({
        id,
        origins: [claude, codex],
        output: finding({ filePath: 'C:\\work\\job-1\\checkout\\src\\loader.ts' }),
        workspaceRoot: ROOT,
      });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.finding).toMatchObject({ id, filePath: 'src/loader.ts', origins: [claude, codex] });
      expect(outcome.finding.location).toEqual({ startLine: 12, endLine: 14 });
    });

    it('rejects traversal and outside-checkout paths instead of repairing them', () => {
      for (const filePath of ['../secret.ts', 'C:\\Windows\\system.ini', 'src/../../x.ts']) {
        const outcome = service.normalizeVerifiedFinding({
          id,
          origins: [claude],
          output: finding({ filePath }),
          workspaceRoot: ROOT,
        });

        expect(outcome.ok, filePath).toBe(false);
      }
    });

    it('rejects a range that ends before it starts', () => {
      const outcome = service.normalizeVerifiedFinding({
        id,
        origins: [claude],
        output: finding({ location: { startLine: 20, endLine: 10, description: null } }),
        workspaceRoot: ROOT,
      });

      expect(outcome).toEqual({ ok: false, reason: 'invalid_finding' });
    });
  });
});
