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

const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/gu,
  /\bAIza[0-9A-Za-z_-]{20,}/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/gu,
  // Azure DevOps personal access tokens are 52 lowercase base32 characters.
  /\b[a-z2-7]{52}\b/gu,
  // Credentials embedded in URLs.
  /(?<=:\/\/)[^\s/@:]+:[^\s/@]+(?=@)/gu,
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
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, REPLACEMENT);
  }

  return result;
}

/** Collapses whitespace and bounds length for single-line diagnostics. */
export function boundedSnippet(text: string, maxLength = 300): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim();

  return collapsed.length <= maxLength ? collapsed : `${collapsed.slice(0, maxLength - 1)}…`;
}
