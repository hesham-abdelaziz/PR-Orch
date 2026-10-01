import type { ProviderId } from '@pr-orchestrator/contracts';

import type { ProviderFailure } from '../provider-adapter.js';
import { boundedSnippet, redactSecrets } from '../redact-secrets.js';

const LOGIN_HINT: Record<ProviderId, string> = {
  claude: 'Run `claude auth login` in a terminal, then refresh providers.',
  codex: 'Run `codex login` in a terminal, then refresh providers.',
  gemini:
    'Start `gemini` once in a terminal to sign in (or configure GEMINI_API_KEY), then refresh providers.',
};

const AUTHENTICATION_PATTERN =
  /not (?:logged|signed) in|not authenticated|authentication (?:failed|required|error)|error authenticating|log ?in required|please (?:run|log ?in|sign in)|invalid api key|unauthori[sz]ed|\b401\b|credentials? (?:are |is )?(?:missing|invalid|expired)/iu;
const MODEL_PATTERN =
  /(?:unknown|invalid|unsupported|unavailable) model|model[^\n]{0,80}(?:not found|not available|does not exist|unsupported|invalid|unknown)|\b404\b/iu;

// Gemini CLI refuses Google sign-ins whose Code Assist tier no longer serves this
// client (exit 41). Signing in again does not help; another credential is needed.
const INELIGIBLE_ACCOUNT_PATTERN = /IneligibleTierError|no longer supported for Gemini Code Assist/iu;

const DIAGNOSTIC_CHARACTERS = 2_000;
const MESSAGE_SNIPPET_CHARACTERS = 300;

export function loginHint(provider: ProviderId): string {
  return LOGIN_HINT[provider];
}

/** Turns a failed provider process into an actionable, secret-free failure. */
export function classifyProviderFailure(input: {
  provider: ProviderId;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  secrets: readonly string[];
}): ProviderFailure {
  const combined = `${input.stderr}\n${input.stdout}`;
  const errorText = redactSecrets(input.stderr.trim() || input.stdout.trim(), input.secrets);
  const exit = input.exitCode === null ? 'was terminated' : `exited with code ${input.exitCode}`;
  const context = {
    exitCode: input.exitCode,
    ...(errorText.length > 0 ? { diagnostics: tail(errorText, DIAGNOSTIC_CHARACTERS) } : {}),
  };
  // The fatal error is normally the last thing a CLI prints (Codex prints its
  // banner and non-fatal cache errors first), so messages quote the tail.
  const snippet = tailSnippet(errorText, MESSAGE_SNIPPET_CHARACTERS);

  if (INELIGIBLE_ACCOUNT_PATTERN.test(combined)) {
    return {
      kind: 'authentication',
      message: `${input.provider} ${exit}: its signed-in account is not eligible for this CLI. Configure another credential (for Gemini, GEMINI_API_KEY or Vertex AI), then refresh providers. Details: ${snippet}`,
      ...context,
    };
  }

  if (AUTHENTICATION_PATTERN.test(combined)) {
    return {
      kind: 'authentication',
      message: `${input.provider} is not authenticated (${exit}). ${LOGIN_HINT[input.provider]}`,
      ...context,
    };
  }

  if (MODEL_PATTERN.test(combined)) {
    return {
      kind: 'model_unavailable',
      message: `${input.provider} rejected the selected model (${exit}). Choose another model. Details: ${snippet}`,
      ...context,
    };
  }

  return {
    kind: 'process',
    message: `${input.provider} ${exit}${snippet.length > 0 ? `: ${snippet}` : ''}`,
    ...context,
  };
}

function tail(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `…${text.slice(text.length - (maxLength - 1))}`;
}

/** One-line, bounded snippet that keeps the end of the text. */
function tailSnippet(text: string, maxLength: number): string {
  const collapsed = boundedSnippet(text, Number.MAX_SAFE_INTEGER);

  return collapsed.length <= maxLength ? collapsed : `…${collapsed.slice(collapsed.length - (maxLength - 1))}`;
}
