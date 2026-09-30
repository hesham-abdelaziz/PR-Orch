import { NormalizedRelativePathSchema } from '@pr-orchestrator/contracts';

export type PathRejection = 'traversal' | 'outside_checkout' | 'invalid';

export type PathValidation =
  | { ok: true; path: string }
  | { ok: false; reason: PathRejection };

const MAX_PATH_LENGTH = 1_024;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;
const WINDOWS_DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const WINDOWS_DRIVE_RELATIVE = /^[A-Za-z]:/u;

function isWindowsRoot(root: string): boolean {
  return WINDOWS_DRIVE_ABSOLUTE.test(root) || root.startsWith('\\\\');
}

function toSlashes(value: string): string {
  return value.replaceAll('\\', '/');
}

/**
 * Turns a model-supplied path into a normalized POSIX path relative to the
 * checkout root, or explains why it cannot be trusted. Nothing here touches the
 * filesystem: findings are only ever labels, never paths the engine opens.
 */
export function validateFindingPath(raw: string, workspaceRoot: string): PathValidation {
  const trimmed = raw.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_PATH_LENGTH) return invalid();
  if (CONTROL_CHARACTERS.test(trimmed)) return invalid();
  if (trimmed.includes('://')) return invalid();
  if (/%2e/iu.test(trimmed)) return { ok: false, reason: 'traversal' };

  let relative: string;

  if (WINDOWS_DRIVE_ABSOLUTE.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\')) {
    const inside = relativeToRoot(trimmed, workspaceRoot);
    if (inside === undefined) {
      return { ok: false, reason: hasTraversal(trimmed) ? 'traversal' : 'outside_checkout' };
    }
    relative = inside;
  } else if (WINDOWS_DRIVE_RELATIVE.test(trimmed)) {
    return { ok: false, reason: 'outside_checkout' };
  } else {
    relative = toSlashes(trimmed);
  }

  if (hasTraversal(relative)) return { ok: false, reason: 'traversal' };

  const collapsed = relative.replace(/\/{2,}/gu, '/').replace(/^(?:\.\/)+/u, '');
  if (collapsed.length === 0 || collapsed === '.' || collapsed.endsWith('/')) return invalid();

  const segments = collapsed.split('/').filter((segment) => segment !== '.');
  const normalized = segments.join('/');
  const contract = NormalizedRelativePathSchema.safeParse(normalized);

  return contract.success ? { ok: true, path: contract.data } : invalid();
}

function invalid(): PathValidation {
  return { ok: false, reason: 'invalid' };
}

function hasTraversal(path: string): boolean {
  return toSlashes(path)
    .split('/')
    .some((segment) => segment === '..');
}

/** Returns the checkout-relative remainder, or undefined if the path is not inside the root. */
function relativeToRoot(absolute: string, root: string): string | undefined {
  // UNC and protocol-relative paths never belong to a local checkout.
  if (absolute.startsWith('\\\\') || absolute.startsWith('//')) return undefined;

  const windowsRoot = isWindowsRoot(root);
  const windowsInput = WINDOWS_DRIVE_ABSOLUTE.test(absolute);
  // A POSIX path cannot lie inside a Windows checkout, and vice versa.
  const comparable = windowsRoot ? windowsInput : !windowsInput && absolute.startsWith('/');
  if (!comparable) return undefined;

  const normalize = (value: string) => {
    const slashed = toSlashes(value).replace(/\/+$/u, '');

    return windowsRoot ? slashed.toLowerCase() : slashed;
  };
  const normalizedRoot = normalize(root);
  const normalizedAbsolute = normalize(absolute);

  if (normalizedAbsolute === normalizedRoot) return '';
  if (!normalizedAbsolute.startsWith(`${normalizedRoot}/`)) return undefined;

  return toSlashes(absolute).slice(normalizedRoot.length + 1);
}
