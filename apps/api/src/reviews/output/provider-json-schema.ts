import { z } from 'zod';

import { ReviewerOutputSchema, VerifierOutputSchema } from './review-output.schemas.js';

// Keywords that some providers' structured-output modes reject. The engine
// enforces every one of these limits itself after parsing.
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'pattern',
  'format',
]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node !== null && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
        .map(([key, value]) => [key, strip(value)]),
    );
  }

  return node;
}

/** JSON Schema for provider structured-output flags and for embedding in prompts. */
export function toProviderJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return strip(z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })) as Record<
    string,
    unknown
  >;
}

export const REVIEWER_OUTPUT_JSON_SCHEMA = toProviderJsonSchema(ReviewerOutputSchema);
export const VERIFIER_OUTPUT_JSON_SCHEMA = toProviderJsonSchema(VerifierOutputSchema);
export const REVIEWER_OUTPUT_JSON_SCHEMA_TEXT = JSON.stringify(REVIEWER_OUTPUT_JSON_SCHEMA);
export const VERIFIER_OUTPUT_JSON_SCHEMA_TEXT = JSON.stringify(VERIFIER_OUTPUT_JSON_SCHEMA);
