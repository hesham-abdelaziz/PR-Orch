import { posix, win32 } from 'node:path';

import type { PreparedWorkspace } from './review-ports.js';

export type PathFlavor = 'win32' | 'posix';

export interface ContextFile {
  label: string;
  /** Absolute, normalized path the provider reads. */
  path: string;
  /** POSIX path relative to the checkout when the file is inside it, else null. */
  checkoutRelativePath: string | null;
}

/**
 * The single interpretation of a prepared workspace used for command
 * construction, prompts, finding normalization and evidence checks:
 *
 * - `checkoutRoot` is the provider's working directory and the root that every
 *   finding path is relative to.
 * - Context files (diff, metadata, technology manifest, standards snapshot) are
 *   addressed by absolute path; `readOnlyDirectories` lists the directories
 *   outside the checkout that must be readable for them.
 */
export interface WorkspaceLayout {
  flavor: PathFlavor;
  checkoutRoot: string;
  contextFiles: ContextFile[];
  readOnlyDirectories: string[];
}

export class WorkspaceLayoutError extends Error {
  override readonly name = 'WorkspaceLayoutError';
}

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/u;

export function pathFlavorOf(path: string): PathFlavor {
  return WINDOWS_DRIVE.test(path) || path.startsWith('\\\\') ? 'win32' : 'posix';
}

function trimTrailingSeparator(path: string, flavor: PathFlavor): string {
  const api = flavor === 'win32' ? win32 : posix;
  const root = api.parse(path).root;
  let result = path;
  while (result.length > root.length && /[\\/]$/u.test(result)) result = result.slice(0, -1);

  return result;
}

/** Normalizes an absolute path of the given flavor; throws when it is not absolute in that flavor. */
export function normalizeAbsolute(path: string, flavor: PathFlavor, label: string): string {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new WorkspaceLayoutError(`${label} is missing.`);
  }
  if (pathFlavorOf(path) !== flavor) {
    throw new WorkspaceLayoutError(`${label} is not an absolute ${flavor === 'win32' ? 'Windows' : 'POSIX'} path.`);
  }
  if (flavor === 'win32' && path.startsWith('\\\\')) {
    throw new WorkspaceLayoutError(`${label} is a network (UNC) path; review workspaces must be on a local drive.`);
  }
  const api = flavor === 'win32' ? win32 : posix;
  if (!api.isAbsolute(path)) throw new WorkspaceLayoutError(`${label} is not absolute.`);

  return trimTrailingSeparator(api.normalize(path), flavor);
}

/**
 * Returns the POSIX-style relative path of `path` inside `root`, '' for the root
 * itself, or null when it lies outside. Windows comparison is case-insensitive.
 */
export function relativeInside(root: string, path: string, flavor: PathFlavor): string | null {
  const api = flavor === 'win32' ? win32 : posix;
  const fold = (value: string) => (flavor === 'win32' ? value.toLowerCase() : value);
  const relative = api.relative(fold(root), fold(path));
  if (relative === '') return '';
  if (relative === '..' || relative.startsWith(`..${api.sep}`) || api.isAbsolute(relative)) return null;

  // Re-slice the original (case-preserving) path rather than the folded one.
  const tail = path.slice(path.length - relative.length);

  return tail.split(api.sep).join('/');
}

export function resolveWorkspaceLayout(
  prepared: PreparedWorkspace,
  standardsPath: string | null = null,
): WorkspaceLayout {
  if (typeof prepared.checkoutPath !== 'string' || prepared.checkoutPath.trim().length === 0) {
    throw new WorkspaceLayoutError('The prepared workspace has no checkout path.');
  }
  const flavor = pathFlavorOf(prepared.checkoutPath);
  const checkoutRoot = normalizeAbsolute(prepared.checkoutPath, flavor, 'Checkout path');
  const workspaceRoot = normalizeAbsolute(prepared.rootPath, flavor, 'Workspace root');
  const api = flavor === 'win32' ? win32 : posix;

  const entries: Array<[string, string | null]> = [
    ['Unified PR diff', prepared.diffPath],
    ['PR metadata (JSON)', prepared.metadataPath],
    ['Detected technologies (JSON)', prepared.technologyManifestPath],
    ['Project standards snapshot', standardsPath],
  ];
  const contextFiles: ContextFile[] = [];
  const directories: string[] = [];

  for (const [label, raw] of entries) {
    if (raw === null) continue;
    const path = normalizeAbsolute(raw, flavor, label);
    const checkoutRelativePath = relativeInside(checkoutRoot, path, flavor);
    contextFiles.push({ label, path, checkoutRelativePath });
    if (checkoutRelativePath !== null) continue;

    directories.push(relativeInside(workspaceRoot, path, flavor) !== null ? workspaceRoot : api.dirname(path));
  }

  // Deduplicate and drop directories already covered by another entry or by the checkout.
  const readOnlyDirectories: string[] = [];
  for (const directory of directories) {
    const covered = [checkoutRoot, ...readOnlyDirectories].some(
      (known) => relativeInside(known, directory, flavor) !== null,
    );
    if (!covered) readOnlyDirectories.push(directory);
  }

  return { flavor, checkoutRoot, contextFiles, readOnlyDirectories };
}
