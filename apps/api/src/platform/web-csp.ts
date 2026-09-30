import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

/** Authorize only exact inline scripts in the trusted local build artifact.
 * Angular's production critical-CSS loader is inline. Hashing it preserves
 * script-src restrictions without permitting arbitrary inline execution. */
export async function webContentSecurityPolicy(
  webRoot?: string,
): Promise<string> {
  if (!webRoot) return POLICY;
  const path = join(webRoot, 'index.html');
  try {
    if ((await stat(path)).size > 1048576)
      throw new Error('Web index exceeds size limit');
    const html = await readFile(path, 'utf8');
    const hashes = new Set<string>();
    for (const match of html.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    )) {
      if (/\bsrc\s*=/i.test(match[1]!) || !match[2]?.trim()) continue;
      const type = /\btype\s*=\s*["']([^"']+)["']/i
        .exec(match[1]!)?.[1]
        ?.toLowerCase();
      if (
        type &&
        !['module', 'text/javascript', 'application/javascript'].includes(type)
      )
        continue;
      hashes.add(
        `'sha256-${createHash('sha256').update(match[2].replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`,
      );
      if (hashes.size > 16) throw new Error('Too many inline web scripts');
    }
    return hashes.size
      ? POLICY.replace(
          "script-src 'self'",
          `script-src 'self' ${[...hashes].join(' ')}`,
        )
      : POLICY;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return POLICY;
    throw error;
  }
}
