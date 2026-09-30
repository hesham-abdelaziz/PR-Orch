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
  /not (?:logged|signed) in|not authenticated|authentication (?:failed|required|error)|log ?in required|please (?:run|log ?in|sign in)|invalid api key|unauthori[sz]ed|\b401\b|credentials? (?:are |is )?(?:missing|invalid|expired)/iu;
const MODEL_PATTERN =
  /(?:unknown|invalid|unsupported|unavailable) model|model[^\n]{0,80}(?:not found|not available|does not exist|unsupported|invalid|unknown)|\b404\b/iu;

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

  if (AUTHENTICATION_PATTERN.test(combined)) {
    return {
      kind: 'authentication',
      message: `${input.provider} is not authenticated. ${LOGIN_HINT[input.provider]}`,
    };
  }

  const snippet = boundedSnippet(redactSecrets(input.stderr.trim() || input.stdout, input.secrets));
  if (MODEL_PATTERN.test(combined)) {
    return {
      kind: 'model_unavailable',
      message: `${input.provider} rejected the selected model. Choose another model. Details: ${snippet}`,
    };
  }

  const exit = input.exitCode === null ? 'was terminated' : `exited with code ${input.exitCode}`;

  return {
    kind: 'process',
    message: `${input.provider} ${exit}${snippet.length > 0 ? `: ${snippet}` : ''}`,
  };
}
