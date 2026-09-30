import type { ProviderId } from '@pr-orchestrator/contracts';

/**
 * Environment variables a provider CLI needs in order to reuse its existing
 * login or configured API key. Only the selected provider's names are
 * forwarded; every other provider's credentials stay in the parent process.
 */
export const PROVIDER_ENVIRONMENT_ALLOWLIST: Readonly<
  Record<ProviderId, readonly string[]>
> = {
  claude: [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CONFIG_DIR',
  ],
  codex: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'CODEX_HOME'],
  gemini: [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_CLOUD_PROJECT',
    'GOOGLE_CLOUD_LOCATION',
    'GOOGLE_APPLICATION_CREDENTIALS',
  ],
};

/** Variables required for a CLI to start and resolve its own configuration. */
const SYSTEM_ENVIRONMENT_ALLOWLIST: ReadonlySet<string> = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'COMMONPROGRAMW6432',
  'USERNAME',
  'USER',
  'LOGNAME',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TZ',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
]);

export interface BuildChildEnvironmentInput {
  /** Environment to filter; callers pass `process.env`. */
  parent: Readonly<Record<string, string | undefined>>;
  /** Provider whose auth variables may be forwarded. */
  provider?: ProviderId;
  /** Non-secret values the caller sets explicitly, for example `NO_COLOR`. */
  overrides?: Readonly<Record<string, string>>;
}

/**
 * Names that can never reach a provider process, regardless of allowlists.
 * "PAT" is matched per name segment so `PATH` and `PATHEXT` are unaffected.
 */
function isHardForbidden(upperName: string): boolean {
  if (
    upperName.includes('AZURE') ||
    upperName.includes('PASSWORD') ||
    upperName.includes('PASSWD') ||
    upperName.includes('SECRET') ||
    upperName.includes('SESSION') ||
    upperName.startsWith('PR_ORCHESTRATOR')
  ) {
    return true;
  }

  return upperName
    .split(/[^A-Z0-9]+/)
    .some((segment) => segment === 'PAT' || segment.endsWith('PAT'));
}

function containsTokenLikeName(upperName: string): boolean {
  return upperName.includes('TOKEN');
}

/**
 * Builds a deny-by-default environment for an AI CLI child process. Nothing is
 * inherited implicitly: only system variables, the selected provider's auth
 * variables, and explicit overrides survive, and Azure/PAT/password/session
 * secrets are removed even if they would otherwise match.
 */
export function buildChildEnvironment(
  input: BuildChildEnvironmentInput,
): Record<string, string> {
  const providerNames = new Set(
    (input.provider ? PROVIDER_ENVIRONMENT_ALLOWLIST[input.provider] : []).map(
      (name) => name.toUpperCase(),
    ),
  );
  const environment: Record<string, string> = {};
  const seen = new Set<string>();

  const consider = (name: string, value: string | undefined, explicit: boolean) => {
    if (value === undefined) return;

    const upper = name.toUpperCase();
    if (seen.has(upper) && !explicit) return;
    if (isHardForbidden(upper)) return;

    const isProviderName = providerNames.has(upper);
    if (containsTokenLikeName(upper) && !isProviderName) return;

    const isAllowed =
      explicit || isProviderName || SYSTEM_ENVIRONMENT_ALLOWLIST.has(upper);
    if (!isAllowed) return;

    seen.add(upper);
    environment[name] = value;
  };

  for (const [name, value] of Object.entries(input.parent)) {
    consider(name, value, false);
  }
  for (const [name, value] of Object.entries(input.overrides ?? {})) {
    consider(name, value, true);
  }

  return environment;
}
