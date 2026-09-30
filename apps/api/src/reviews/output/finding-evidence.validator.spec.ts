import { describe, expect, it } from 'vitest';

import { finding } from '../../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { InMemoryCheckout } from '../../../../../tests/fixtures/fake-clis/in-memory-checkout.js';
import {
  checkFindingLocation,
  codeExcerpts,
  findEvidenceAnchor,
  isNearCandidates,
} from './finding-evidence.validator.js';

const checkout = new InMemoryCheckout({
  'src/loader.ts': ['import { load } from "./io";', '', 'export function read(config) {', '  const port = config.value.port;', '  return   port + 1;', '}'].join('\n'),
});
const inspector = checkout.forCheckout('/checkout');
const file = { path: 'src/loader.ts', lines: checkout.lines('src/loader.ts') };

describe('checkFindingLocation', () => {
  it('accepts an existing file and line range', async () => {
    expect((await checkFindingLocation(finding({ location: { startLine: 4, endLine: 5 } }), inspector, new Set())).ok).toBe(true);
  });

  it.each([
    [{ filePath: 'src/missing.ts', location: { startLine: 1 } }, /does not exist/u],
    [{ location: { startLine: 7 } }, /outside the file, which has 6 line/u],
    [{ location: { startLine: 4, endLine: 40 } }, /src\/loader\.ts:4-40 is outside the file/u],
  ] as const)('rejects %j', async (overrides, message) => {
    const outcome = await checkFindingLocation(finding(overrides as Parameters<typeof finding>[0]), inspector, new Set());

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.issue).toMatch(message);
  });

  it('rejects a file that is excluded from inspection', async () => {
    const outcome = await checkFindingLocation(finding({ location: { startLine: 4 } }), inspector, new Set(['src/loader.ts']));

    expect(outcome).toEqual({ ok: false, issue: 'src/loader.ts is excluded from detailed inspection' });
  });
});

describe('findEvidenceAnchor', () => {
  const at = (evidence: string, startLine = 4, endLine?: number) =>
    findEvidenceAnchor({ filePath: 'src/loader.ts', location: { startLine, ...(endLine ? { endLine } : {}) }, evidence }, file);

  it('finds an inline excerpt in the cited line', () => {
    expect(at('Reads `config.value.port` without a null check.')).toBe(4);
  });

  it('normalizes whitespace and accepts fenced blocks', () => {
    expect(at('The code:\n```ts\nreturn port + 1;\n```\nnever validates port.', 5)).toBe(5);
  });

  it('treats [REDACTED] as a gap', () => {
    expect(at('Reads `const port = [REDACTED].port;`')).toBe(4);
  });

  it('allows a small tolerance around the cited range', () => {
    expect(at('Uses `config.value.port`', 2)).toBe(4);
  });

  it.each([
    ['prose without any quoted code', 'Line 4 reads config.value without a null check.'],
    ['a quote that is not in the file', 'Reads `config.missing.port`.'],
    ['a quote that is too short to be evidence', 'Uses `(`.'],
  ])('returns null for %s', (_name, evidence) => {
    expect(at(evidence)).toBeNull();
  });

  it('returns null when the quoted code is real but far from the cited lines', () => {
    const big = { path: 'big.ts', lines: [...Array.from({ length: 40 }, (_, index) => `line ${index + 1}`), 'const secret = read();'] };

    expect(findEvidenceAnchor({ filePath: 'big.ts', location: { startLine: 5 }, evidence: '`const secret = read();`' }, big)).toBeNull();
  });

  it('extracts only non-trivial excerpts', () => {
    expect(codeExcerpts('`a` and `config.value` and ```\nfoo();\n\n```')).toEqual(['foo();', 'config.value']);
  });
});

describe('isNearCandidates', () => {
  const candidate = { filePath: 'src/loader.ts', location: { startLine: 40, endLine: 42 } };

  it('accepts the same or a nearby range in the same file', () => {
    expect(isNearCandidates({ filePath: 'src/loader.ts', location: { startLine: 41 } }, [candidate])).toBe(true);
    expect(isNearCandidates({ filePath: 'src/loader.ts', location: { startLine: 55 } }, [candidate])).toBe(true);
  });

  it('rejects a distant range or another file', () => {
    expect(isNearCandidates({ filePath: 'src/loader.ts', location: { startLine: 80 } }, [candidate])).toBe(false);
    expect(isNearCandidates({ filePath: 'src/other.ts', location: { startLine: 40 } }, [candidate])).toBe(false);
  });
});
