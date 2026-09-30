const REPLACEMENT = '[REDACTED]';

const SECRET_NAME_PARTS = [
  'KEY',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASSWD',
  'CREDENTIAL',
  'AZURE',
  'SESSION',
];

/**
 * Credential shapes removed from any text before it is stored or delivered.
 * Each pattern needs a distinctive prefix or structure, so ordinary code
 * identifiers, hashes and prose ("Bearer authentication") are left intact.
 */
const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; replace: string }> = [
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
    replace: REPLACEMENT,
  },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/gu, replace: REPLACEMENT },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}/gu, replace: REPLACEMENT },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/gu, replace: REPLACEMENT },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/gu, replace: REPLACEMENT },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu, replace: REPLACEMENT },
  { pattern: /\bxox[abeprs]-[A-Za-z0-9-]{10,}/gu, replace: REPLACEMENT },
  // A bearer token must look like one (contains a digit, or is a JWT-like dotted value).
  {
    pattern: /\bBearer\s+(?=[A-Za-z0-9._~+/-]*[0-9.])[A-Za-z0-9._~+/-]{16,}=*/gu,
    replace: REPLACEMENT,
  },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/gu, replace: REPLACEMENT },
  // Azure DevOps personal access tokens are 52 lowercase base32 characters.
  { pattern: /\b[a-z2-7]{52}\b/gu, replace: REPLACEMENT },
  // Credentials embedded in URLs; template placeholders such as ${user} are not credentials.
  { pattern: /(?<=:\/\/)(?![$%{<])[^\s/@:]+:(?![$%{<])[^\s/@]+(?=@)/gu, replace: REPLACEMENT },
  // A quoted literal assigned to a secret-named key: keep the key, drop the value.
  {
    pattern:
      /(\b[A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\b["']?\s*[:=]\s*["'`])(?![$%{<])([^"'`\s]{8,})(["'`])/giu,
    replace: `$1${REPLACEMENT}$3`,
  },
];

/** Environment values that must never be echoed back in diagnostics. */
export function collectSecretValues(
  environment: Readonly<Record<string, string | undefined>>,
): string[] {
  const values = new Set<string>();

  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || value.length < 6) continue;

    const upper = name.toUpperCase();
    const looksSecret =
      SECRET_NAME_PARTS.some((part) => upper.includes(part)) ||
      upper.split(/[^A-Z0-9]+/).some((segment) => segment === 'PAT' || segment.endsWith('PAT'));
    if (looksSecret) values.add(value);
  }

  return [...values].sort((left, right) => right.length - left.length);
}

/** Removes known secret values and common credential shapes from text. */
export function redactSecrets(text: string, knownSecrets: readonly string[] = []): string {
  let result = text;

  for (const secret of knownSecrets) {
    if (secret.length >= 6) result = result.split(secret).join(REPLACEMENT);
  }
  for (const { pattern, replace } of SECRET_PATTERNS) {
    result = result.replace(pattern, replace);
  }

  return result;
}

/** Collapses whitespace and bounds length for single-line diagnostics. */
export function boundedSnippet(text: string, maxLength = 300): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim();

  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}…`;
}
