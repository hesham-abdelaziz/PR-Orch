import { Injectable } from '@nestjs/common';

import { wrapUntrusted } from './core-review-policy.js';

export interface CorrectionPromptInput {
  /** The exact prompt of the failed attempt; the correction extends it. */
  originalPrompt: string;
  /** Validation problems from the parser (field paths and messages only). */
  issues: readonly string[];
  previousOutput: string;
}

const MAX_ISSUES = 15;
const MAX_ISSUE_LENGTH = 240;
const MAX_PREVIOUS_OUTPUT = 3_000;

@Injectable()
export class CorrectionPromptBuilder {
  build(input: CorrectionPromptInput): string {
    const issues = input.issues
      .slice(0, MAX_ISSUES)
      .map((issue) => `- ${issue.slice(0, MAX_ISSUE_LENGTH)}`);
    const truncated = input.previousOutput.length > MAX_PREVIOUS_OUTPUT;
    const previous = truncated
      ? `${input.previousOutput.slice(0, MAX_PREVIOUS_OUTPUT)}\n[…truncated]`
      : input.previousOutput;

    return [
      input.originalPrompt,
      '# CORRECTION REQUIRED (final correction attempt)',
      'Your previous answer failed schema validation. Fix exactly these problems:',
      issues.join('\n'),
      'For reference, your previous answer was:',
      wrapUntrusted('PREVIOUS_ANSWER', previous),
      'Return only one JSON object that matches the output schema. This is the final correction attempt; a second invalid answer fails this run.',
    ].join('\n\n');
  }
}
