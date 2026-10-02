/**
 * Escaping helpers for model-authored text embedded in the canonical Markdown
 * report. The report is rendered from validated structured data only; these
 * helpers make sure that data can neither inject HTML nor forge structure
 * (headings, fences, lists) nor smuggle unsafe links or remote images.
 */

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u{2028}\u{2029}]/gu;
const BIDI_CONTROLS = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

/** Multi-line model text made inert: safe to place at column 0 under a label. */
export function sanitizeBlock(text: string): string {
  const cleaned = text
    .replace(/\r\n?/gu, '\n')
    .replace(CONTROL_CHARACTERS, '')
    .replace(BIDI_CONTROLS, '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');

  const withoutImages = cleaned
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/gu, '(image omitted)')
    .replace(/!\[[^\]\n]*\]\[[^\]\n]*\]/gu, '(image omitted)');

  const withSafeLinks = withoutImages.replace(
    /\[([^\]\n]*)\]\(\s*([^)\n]*)\)/gu,
    (match: string, label: string, destination: string) =>
      /^https?:\/\//iu.test(destination.trim()) ? match : label,
  );

  const withoutReferenceDefinitions = withSafeLinks.replace(
    /^[ \t]{0,3}\[[^\]\n]+\]:[^\n]*$/gmu,
    '',
  );

  const withInertSchemes = withoutReferenceDefinitions.replace(
    /\b(javascript|vbscript|data|file):(?=\S)/giu,
    '$1&#58;',
  );

  return withInertSchemes
    .split('\n')
    .map((line) =>
      line.replace(/^(\s*)([#>*+\-=~`|_]|\d+[.)](?=\s))/u, (_match, indent: string, lead: string) => `${indent}\\${lead}`),
    )
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Single-line variant for headings, list items and table-like lines. */
export function sanitizeInline(text: string): string {
  return sanitizeBlock(text).replace(/\s*\n\s*/gu, ' ').trim();
}

/** Inline code span with characters that could break out of it removed. */
export function codeSpan(text: string): string {
  const flat = text
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(BIDI_CONTROLS, '')
    .replace(/\s+/gu, ' ')
    .replace(/[`<>&]/gu, "'")
    .trim();

  return `\`${flat}\``;
}

/**
 * Fenced code block for model-authored code or output. The fence is longer than
 * any backtick run in the text so the text cannot close it, and control and
 * bidirectional characters are removed. Returns the lines of the block.
 */
export function codeBlock(text: string, language = ''): string[] {
  const body = text.replace(/\r\n?/gu, '\n').replace(CONTROL_CHARACTERS, '').replace(BIDI_CONTROLS, '').trim();
  const longest = Math.max(0, ...[...body.matchAll(/`+/gu)].map((run) => run[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));

  return [`${fence}${language}`, body, fence];
}
