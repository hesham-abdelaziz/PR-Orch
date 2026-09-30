import { describe, expect, it } from 'vitest';

import { ProviderOutputParser } from './provider-output.parser.js';

const parser = new ProviderOutputParser();

const reviewerPayload = {
  findings: [
    {
      title: 'Unchecked null dereference in loader',
      severity: 'high',
      filePath: 'src/loader.ts',
      location: { startLine: 12, endLine: 14, description: null },
      evidence: 'Line 12 reads config.value without a null check.',
      impact: 'The loader throws for empty configuration.',
      suggestedFix: 'Guard config before reading value.',
      reference: null,
    },
  ],
  warnings: [],
  exclusions: [],
};
const payloadText = JSON.stringify(reviewerPayload);

const CANDIDATE_ID = '11111111-1111-5111-8111-111111111111';
const verifierPayload = {
  summary: 'One claim confirmed.',
  decisions: [
    {
      candidateIds: [CANDIDATE_ID],
      verdict: 'accepted',
      rationale: 'Confirmed at src/loader.ts:12.',
      locationCorrection: null,
      finding: reviewerPayload.findings[0],
    },
    {
      candidateIds: ['22222222-2222-5222-8222-222222222222'],
      verdict: 'rejected',
      rationale: 'The null check exists on line 10.',
      locationCorrection: null,
      finding: null,
    },
  ],
  warnings: [],
};

function expectReviewer(rawOutput: string, provider: 'claude' | 'codex' | 'gemini' = 'claude') {
  const parsed = parser.parseReviewer({ provider, rawOutput });
  if (!parsed.ok) throw new Error(`expected success, got ${JSON.stringify(parsed.error)}`);

  return parsed.value;
}

describe('ProviderOutputParser.parseReviewer', () => {
  it('parses a bare JSON document', () => {
    expect(expectReviewer(payloadText).findings[0]?.title).toBe(
      'Unchecked null dereference in loader',
    );
  });

  it('extracts JSON from a fenced block surrounded by prose', () => {
    const raw = `Here is my review:\n\n\`\`\`json\n${JSON.stringify(reviewerPayload, null, 2)}\n\`\`\`\n\nLet me know if you need more.`;

    expect(expectReviewer(raw).findings).toHaveLength(1);
  });

  it('extracts JSON embedded in prose without fences', () => {
    const raw = `Sure thing! ${payloadText} Hope this helps {not json}.`;

    expect(expectReviewer(raw).findings).toHaveLength(1);
  });

  it('prefers the object that has the expected top-level keys over unrelated objects', () => {
    const raw = `Metadata: {"note": "draft"}\nFinal: ${payloadText}`;

    expect(expectReviewer(raw).findings).toHaveLength(1);
  });

  it('ignores JSON-looking text inside string values', () => {
    const tricky = {
      ...reviewerPayload,
      findings: [
        {
          ...reviewerPayload.findings[0],
          evidence: 'The code embeds {"findings": [], "warnings": [], "exclusions": []} in a string.',
        },
      ],
    };

    const value = expectReviewer(`Result: ${JSON.stringify(tricky)}`);

    expect(value.findings).toHaveLength(1);
  });

  it('reads the structured_output field of a Claude result envelope', () => {
    const envelope = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Done.',
      structured_output: reviewerPayload,
    });

    expect(expectReviewer(envelope, 'claude').findings).toHaveLength(1);
  });

  it('falls back to the Claude result text when there is no structured_output', () => {
    const envelope = JSON.stringify({
      type: 'result',
      is_error: false,
      result: `\`\`\`json\n${payloadText}\n\`\`\``,
    });

    expect(expectReviewer(envelope, 'claude').findings).toHaveLength(1);
  });

  it('reads the response field of a Gemini JSON envelope', () => {
    const envelope = JSON.stringify({ response: `Review:\n${payloadText}`, stats: { models: {} } });

    expect(expectReviewer(envelope, 'gemini').findings).toHaveLength(1);
  });

  it('uses only the last agent message of a Codex JSONL stream', () => {
    const draft = JSON.stringify({ ...reviewerPayload, findings: [] });
    const lines = [
      { type: 'thread.started', thread_id: 't' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: '1', type: 'agent_message', text: draft } },
      { type: 'item.completed', item: { id: '2', type: 'command_execution', command: 'ls' } },
      { type: 'item.completed', item: { id: '3', type: 'agent_message', text: payloadText } },
      { type: 'turn.completed', usage: {} },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');

    expect(expectReviewer(lines, 'codex').findings).toHaveLength(1);
  });

  it('uses the final result event of a Claude stream-json transcript', () => {
    const lines = [
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: { content: [{ type: 'text', text: '{"findings": []}' }] } },
      { type: 'result', is_error: false, structured_output: reviewerPayload },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');

    expect(expectReviewer(lines, 'claude').findings).toHaveLength(1);
  });

  it('asks for correction when there is no JSON at all', () => {
    const parsed = parser.parseReviewer({ provider: 'claude', rawOutput: 'I found no issues, great PR!' });

    expect(parsed).toMatchObject({ ok: false, error: { kind: 'correction_needed', reason: 'no_json' } });
  });

  it('asks for correction on empty output', () => {
    expect(parser.parseReviewer({ provider: 'codex', rawOutput: '  \n ' })).toMatchObject({
      ok: false,
      error: { reason: 'empty_output' },
    });
  });

  it('asks for correction on truncated JSON without repairing it', () => {
    const parsed = parser.parseReviewer({
      provider: 'claude',
      rawOutput: payloadText.slice(0, payloadText.length - 20),
    });

    expect(parsed).toMatchObject({ ok: false, error: { reason: 'invalid_json' } });
  });

  it.each([
    ['unknown finding field', { findings: [{ ...reviewerPayload.findings[0], confidence: 0.9 }], warnings: [], exclusions: [] }],
    ['unknown top-level field', { ...reviewerPayload, score: 7 }],
    ['invalid severity', { ...reviewerPayload, findings: [{ ...reviewerPayload.findings[0], severity: 'severe' }] }],
    ['missing evidence', { ...reviewerPayload, findings: [{ ...reviewerPayload.findings[0], evidence: '' }] }],
    ['evidence field absent', { ...reviewerPayload, findings: [{ ...reviewerPayload.findings[0], evidence: undefined }] }],
    ['oversized evidence', { ...reviewerPayload, findings: [{ ...reviewerPayload.findings[0], evidence: 'x'.repeat(5_001) }] }],
    ['oversized title', { ...reviewerPayload, findings: [{ ...reviewerPayload.findings[0], title: 't'.repeat(201) }] }],
    ['string line number', { ...reviewerPayload, findings: [{ ...reviewerPayload.findings[0], location: { startLine: '12', endLine: null, description: null } }] }],
    ['zero line number', { ...reviewerPayload, findings: [{ ...reviewerPayload.findings[0], location: { startLine: 0, endLine: null, description: null } }] }],
    ['missing warnings array', { findings: [], exclusions: [] }],
    ['findings not an array', { ...reviewerPayload, findings: 'none' }],
  ])('rejects %s with a schema violation', (_name, payload) => {
    const parsed = parser.parseReviewer({ provider: 'claude', rawOutput: JSON.stringify(payload) });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.error.kind).toBe('correction_needed');
    expect(parsed.error.reason).toBe('schema_violation');
    expect(parsed.error.issues.length).toBeGreaterThan(0);
    expect(parsed.error.issues.every((issue) => issue.length <= 300)).toBe(true);
  });

  it('never echoes rejected field values in correction issues', () => {
    const secretish = 'PLEASE-DO-NOT-ECHO-THIS-VALUE';
    const parsed = parser.parseReviewer({
      provider: 'claude',
      rawOutput: JSON.stringify({ ...reviewerPayload, findings: [{ ...reviewerPayload.findings[0], severity: secretish }] }),
    });

    expect(JSON.stringify(parsed)).not.toContain(secretish);
  });

  it('does not accept verifier output where reviewer output is expected', () => {
    expect(
      parser.parseReviewer({ provider: 'claude', rawOutput: JSON.stringify(verifierPayload) }).ok,
    ).toBe(false);
  });

  it('keeps absolute and traversal paths for the normalizer to reject', () => {
    const payload = {
      ...reviewerPayload,
      findings: [
        { ...reviewerPayload.findings[0], filePath: 'C:\\Windows\\win.ini' },
        { ...reviewerPayload.findings[0], filePath: '../../etc/passwd' },
      ],
    };

    expect(expectReviewer(JSON.stringify(payload)).findings.map((finding) => finding.filePath)).toEqual([
      'C:\\Windows\\win.ini',
      '../../etc/passwd',
    ]);
  });
});

describe('ProviderOutputParser.parseVerifier', () => {
  it('parses verifier decisions with accepted, merged, and rejected verdicts', () => {
    const parsed = parser.parseVerifier({
      provider: 'codex',
      rawOutput: `Final answer:\n${JSON.stringify(verifierPayload)}`,
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.value.decisions.map((decision) => decision.verdict)).toEqual(['accepted', 'rejected']);
    expect(parsed.value.summary).toBe('One claim confirmed.');
  });

  it.each([
    ['accepted without a finding', { ...verifierPayload.decisions[0], finding: null }],
    ['rejected with a finding', { ...verifierPayload.decisions[1], finding: reviewerPayload.findings[0] }],
    ['unknown verdict', { ...verifierPayload.decisions[0], verdict: 'maybe' }],
    ['non-uuid candidate id', { ...verifierPayload.decisions[0], candidateIds: ['abc'] }],
    ['empty candidate ids', { ...verifierPayload.decisions[0], candidateIds: [] }],
    ['missing rationale', { ...verifierPayload.decisions[0], rationale: '' }],
    ['extra decision field', { ...verifierPayload.decisions[0], confidence: 0.8 }],
  ])('rejects a decision with %s', (_name, decision) => {
    const parsed = parser.parseVerifier({
      provider: 'claude',
      rawOutput: JSON.stringify({ ...verifierPayload, decisions: [decision] }),
    });

    expect(parsed).toMatchObject({ ok: false, error: { kind: 'correction_needed' } });
  });

  it('does not accept reviewer output where verifier output is expected', () => {
    expect(parser.parseVerifier({ provider: 'claude', rawOutput: payloadText }).ok).toBe(false);
  });
});
