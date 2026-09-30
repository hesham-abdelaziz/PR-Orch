import { describe, expect, it } from 'vitest';

import { CorrectionPromptBuilder } from './correction-prompt.builder.js';

const builder = new CorrectionPromptBuilder();

describe('CorrectionPromptBuilder', () => {
  const base = {
    originalPrompt: 'ORIGINAL PROMPT BODY',
    issues: ['findings.0.severity: Invalid option', 'findings.0.evidence: Too small'],
    previousOutput: '{"findings": [ {"severity": "severe"} ]}',
  };

  it('keeps the original prompt and lists the validation problems', () => {
    const prompt = builder.build(base);

    expect(prompt.startsWith('ORIGINAL PROMPT BODY')).toBe(true);
    expect(prompt).toContain('findings.0.severity: Invalid option');
    expect(prompt).toContain('findings.0.evidence: Too small');
    expect(prompt).toMatch(/only (?:one|a single) JSON object/i);
    expect(prompt).toMatch(/final (?:attempt|correction)/i);
  });

  it('shows the previous answer as delimited data and bounds its size', () => {
    const prompt = builder.build({ ...base, previousOutput: 'x'.repeat(20_000) });

    expect(prompt).toMatch(/<<<BEGIN UNTRUSTED PREVIOUS_ANSWER [0-9a-f]{16}>>>/u);
    expect(prompt.length).toBeLessThan(base.originalPrompt.length + 8_000);
    expect(prompt).toMatch(/truncated/i);
  });

  it('bounds the number and length of issues', () => {
    const prompt = builder.build({
      ...base,
      issues: Array.from({ length: 200 }, (_, index) => `issue-${index}: ${'y'.repeat(500)}`),
    });

    expect(prompt).toContain('issue-0');
    expect(prompt).not.toContain('issue-100');
    expect(prompt.length).toBeLessThan(12_000);
  });
});
