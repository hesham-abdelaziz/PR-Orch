import { lstat, open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/** The master plan's hard limit for an individually inspectable file. */
export const MAX_INSPECTABLE_FILE_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;

export type InspectRejection =
  | 'missing'
  | 'not_a_file'
  | 'outside_checkout'
  | 'git_internal'
  | 'too_large'
  | 'binary'
  | 'unreadable';

export interface InspectedFile {
  /** Checkout-relative POSIX path. */
  path: string;
  /** File lines without terminators; line N is `lines[N - 1]`. */
  lines: readonly string[];
}

export type InspectOutcome = { ok: true; file: InspectedFile } | { ok: false; reason: InspectRejection };

/** Read-only view of one immutable prepared checkout. */
export interface CheckoutInspector {
  /** `relativePath` is an already-normalized, checkout-relative POSIX path. */
  inspect(relativePath: string): Promise<InspectOutcome>;
}

export interface CheckoutInspectorFactory {
  forCheckout(checkoutRoot: string): CheckoutInspector;
}

export const REJECTION_TEXT: Readonly<Record<InspectRejection, string>> = {
  missing: 'does not exist in the checkout',
  not_a_file: 'is not a regular file',
  outside_checkout: 'resolves outside the checkout (symbolic link or junction)',
  git_internal: 'is Git metadata, not reviewable source',
  too_large: 'is larger than the 1 MiB inspection limit',
  binary: 'is a binary file',
  unreadable: 'could not be read',
};

export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/u);
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();

  return lines;
}

/**
 * Reads files of the prepared checkout, and only those: the real path of every
 * file must stay inside the real path of the checkout, so a symbolic link,
 * junction or reparse point cannot lead outside it. Results are memoized; the
 * checkout is immutable for the lifetime of a job.
 */
export class FileSystemCheckoutInspector implements CheckoutInspector {
  private readonly cache = new Map<string, Promise<InspectOutcome>>();
  private realRoot: Promise<string> | null = null;

  constructor(private readonly checkoutRoot: string) {}

  inspect(relativePath: string): Promise<InspectOutcome> {
    let outcome = this.cache.get(relativePath);
    if (!outcome) {
      outcome = this.load(relativePath);
      this.cache.set(relativePath, outcome);
    }

    return outcome;
  }

  private async load(relativePath: string): Promise<InspectOutcome> {
    const segments = relativePath.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      return { ok: false, reason: 'outside_checkout' };
    }
    if (segments.some((segment) => segment.toLowerCase() === '.git')) return { ok: false, reason: 'git_internal' };

    try {
      this.realRoot ??= realpath(this.checkoutRoot);
      const root = await this.realRoot;
      const candidate = join(this.checkoutRoot, ...segments);

      try {
        await lstat(candidate);
      } catch {
        return { ok: false, reason: 'missing' };
      }

      let real: string;
      try {
        real = await realpath(candidate);
      } catch {
        // A dangling link, or a link loop.
        return { ok: false, reason: 'missing' };
      }
      const inside = relative(root, real);
      if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
        return { ok: false, reason: 'outside_checkout' };
      }

      const info = await stat(real);
      if (!info.isFile()) return { ok: false, reason: 'not_a_file' };
      if (info.size > MAX_INSPECTABLE_FILE_BYTES) return { ok: false, reason: 'too_large' };

      const handle = await open(real, 'r');
      let buffer: Buffer;
      try {
        buffer = await handle.readFile();
      } finally {
        await handle.close();
      }
      if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return { ok: false, reason: 'binary' };

      return { ok: true, file: { path: relativePath, lines: splitLines(buffer.toString('utf8')) } };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  }
}

export class FileSystemCheckoutInspectorFactory implements CheckoutInspectorFactory {
  forCheckout(checkoutRoot: string): CheckoutInspector {
    return new FileSystemCheckoutInspector(checkoutRoot);
  }
}
