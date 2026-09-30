import { Injectable } from '@nestjs/common';
import type { ModelSelection, ReviewFinding } from '@pr-orchestrator/contracts';

import { VERIFIER_OUTPUT_JSON_SCHEMA_TEXT } from '../output/provider-json-schema.js';
import {
  CORE_VERIFIER_RULES,
  finalReminder,
  guidanceSection,
  jobContextSection,
  rulesSection,
  wrapUntrusted,
  type PromptPullRequest,
  type PromptStandards,
  type PromptWorkspace,
} from './core-review-policy.js';

export interface VerifierPromptInput {
  verifier: ModelSelection;
  pullRequest: PromptPullRequest;
  workspace: PromptWorkspace;
  standards: PromptStandards;
  /** Normalized candidates from every successful reviewer, with stable ids and origins. */
  candidates: readonly ReviewFinding[];
  /** Job-level warnings such as failed or timed-out reviewers. */
  jobWarnings: readonly string[];
}

@Injectable()
export class VerifierPromptBuilder {
  build(input: VerifierPromptInput): string {
    const ids = input.candidates.map((candidate) => candidate.id);

    return [
      '# ROLE\nYou are the main verifier. Independent reviewers submitted candidate findings; you decide which are real.',
      rulesSection('IMMUTABLE RULES', CORE_VERIFIER_RULES),
      jobContextSection(input.pullRequest, {
        ...input.workspace,
        warnings: [...input.workspace.warnings, ...input.jobWarnings],
      }),
      guidanceSection(input.standards, 'verifier'),
      `# CANDIDATE IDS (${ids.length})\nYou must return exactly one decision covering each of these ids:\n${ids.join('\n')}`,
      '# CANDIDATE FINDINGS\nEach candidate lists the reviewer models that reported it in `origins`.',
      wrapUntrusted('CANDIDATE_FINDINGS', JSON.stringify(input.candidates)),
      `# OUTPUT SCHEMA\nAnswer with a single JSON object that validates against this JSON Schema. Use finding: null for rejected decisions.\n${VERIFIER_OUTPUT_JSON_SCHEMA_TEXT}`,
      finalReminder(),
    ].join('\n\n');
  }
}
