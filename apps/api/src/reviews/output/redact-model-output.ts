import { redactSecrets } from '../../providers/redact-secrets.js';

/**
 * Applies the shared redaction policy to every string inside validated model
 * output (titles, evidence, impact, suggested fixes, references, location
 * descriptions, rationales, summaries, warnings, exclusion reasons and paths).
 *
 * It runs once, at the parse boundary, before anything is normalized,
 * persisted, rendered, logged, sent over SSE, or passed on to the verifier, so
 * every downstream copy is derived from redacted text. Structure, numbers and
 * booleans are untouched, so the output stays schema-valid.
 */
export function redactModelOutput<T>(value: T, knownSecrets: readonly string[] = []): T {
  return redactValue(value, knownSecrets) as T;
}

function redactValue(value: unknown, knownSecrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactSecrets(value, knownSecrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, knownSecrets));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactValue(item, knownSecrets)]),
    );
  }

  return value;
}
