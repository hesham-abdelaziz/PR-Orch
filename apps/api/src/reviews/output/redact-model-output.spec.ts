import { describe, expect, it } from 'vitest';

import { SYNTHETIC_SECRETS as S } from '../../../../../tests/fixtures/fake-clis/synthetic-secrets.js';
import { redactModelOutput } from './redact-model-output.js';
import { ReviewerOutputSchema, VerifierOutputSchema } from './review-output.schemas.js';

const finding = {
  title: `Key ${S.aws} committed`,
  severity: 'high' as const,
  filePath: 'src/config.ts',
  location: { startLine: 3, endLine: null, description: `near ${S.openAi}` },
  evidence: `Line 3: \`${S.assignment}\``,
  impact: 'Credential exposure.',
  suggestedFix: `Rotate ${S.github}.`,
  reference: null,
};

describe('redactModelOutput', () => {
  it('redacts every text field of reviewer output and keeps it schema-valid', () => {
    const output = ReviewerOutputSchema.parse({
      findings: [finding],
      warnings: [`saw ${S.slack}`],
      exclusions: [{ path: 'dist/app.js', reason: `embeds ${S.azurePat}` }],
    });

    const redacted = redactModelOutput(output);

    expect(ReviewerOutputSchema.parse(redacted)).toEqual(redacted);
    const text = JSON.stringify(redacted);
    for (const secret of [S.aws, S.openAi, S.assignment, S.github, S.slack, S.azurePat]) expect(text).not.toContain(secret);
    expect(redacted.findings[0]?.evidence).toBe('Line 3: `const apiKey = "[REDACTED]";`');
    expect(redacted.findings[0]?.location.startLine).toBe(3);
    expect(redacted.findings[0]?.filePath).toBe('src/config.ts');
  });

  it('redacts summaries, rationales and warnings of verifier output, including exact known values', () => {
    const output = VerifierOutputSchema.parse({
      summary: `Found synthetic-known-value-9 and ${S.jwt}`,
      decisions: [
        { candidateIds: ['00000000-0000-4000-8000-000000000001'], verdict: 'rejected', rationale: `false alarm, ${S.bearer}`, finding: null },
      ],
      warnings: [`see ${S.urlCredential}`],
    });

    const redacted = redactModelOutput(output, ['synthetic-known-value-9']);

    expect(redacted.summary).toBe('Found [REDACTED] and [REDACTED]');
    expect(redacted.decisions[0]?.rationale).toBe('false alarm, [REDACTED]');
    expect(redacted.decisions[0]?.candidateIds).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(redacted.warnings).toEqual(['see https://[REDACTED]@dev.azure.com/acme']);
  });

  it('leaves ordinary technical content untouched', () => {
    const output = ReviewerOutputSchema.parse({
      findings: [
        {
          ...finding,
          title: 'Token refresh races with logout',
          evidence: 'Line 3: `const token = await this.auth.getToken(); headers.Authorization = `Bearer ${token}`;`',
          location: { startLine: 3, endLine: 9, description: null },
          suggestedFix: 'Await tokenRefreshQueueProcessor before clearing the session.',
        },
      ],
      warnings: [],
      exclusions: [],
    });

    expect(redactModelOutput(output)).toEqual(output);
  });
});
