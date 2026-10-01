import { validateFindingPath } from '../../reviews/output/finding-path.validator.js';
import type { ProviderActivityObservation } from '../provider-adapter.js';
import { redactSecrets } from '../redact-secrets.js';
import type { RawActivity } from './stream-decoder.js';

const TOOL_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const MAX_TARGET_PATH = 500;

/**
 * Turns a decoder's raw activity into the observation sent to the engine:
 * the tool name must match the allowlist shape, and a path is kept only when it
 * normalizes to a checkout-relative path that redaction leaves unchanged.
 * Paths outside the checkout (context files, system directories) are dropped,
 * never shown. Line numbers survive only alongside a kept path.
 */
export function toObservation(
  raw: RawActivity,
  workspaceRoot: string,
  secrets: readonly string[],
): ProviderActivityObservation {
  const observation: ProviderActivityObservation = { action: raw.action };
  if (raw.tool !== undefined && TOOL_PATTERN.test(raw.tool)) observation.tool = raw.tool;
  if (raw.path === undefined) return observation;

  const validated = validateFindingPath(raw.path, workspaceRoot);
  if (!validated.ok || validated.path.length > MAX_TARGET_PATH) return observation;
  if (redactSecrets(validated.path, secrets) !== validated.path) return observation;

  observation.target = { path: validated.path };
  if (raw.startLine !== undefined) {
    observation.target.startLine = raw.startLine;
    if (raw.endLine !== undefined && raw.endLine >= raw.startLine) observation.target.endLine = raw.endLine;
  }

  return observation;
}
