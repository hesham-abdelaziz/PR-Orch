import { describe, expect, it } from 'vitest';

import type { PreparedWorkspace } from './review-ports.js';
import { WorkspaceLayoutError, resolveWorkspaceLayout } from './workspace-layout.js';

function prepared(overrides: Partial<PreparedWorkspace>): PreparedWorkspace {
  return {
    workspaceId: 'ws-1',
    rootPath: '/data/workspaces/ws-1',
    checkoutPath: '/data/workspaces/ws-1/checkout',
    sourceCommit: 'a'.repeat(40),
    targetCommit: 'b'.repeat(40),
    diffPath: '/data/workspaces/ws-1/context/pr.diff',
    metadataPath: '/data/workspaces/ws-1/context/pr.json',
    technologyManifestPath: '/data/workspaces/ws-1/context/technologies.json',
    standardsPath: null,
    exclusions: [],
    warnings: [],
    ...overrides,
  };
}

describe('resolveWorkspaceLayout', () => {
  it('uses the checkout as the provider working directory and grants the workspace root read access for context files', () => {
    const layout = resolveWorkspaceLayout(prepared({}));

    expect(layout.checkoutRoot).toBe('/data/workspaces/ws-1/checkout');
    expect(layout.readOnlyDirectories).toEqual(['/data/workspaces/ws-1']);
    expect(layout.contextFiles).toEqual([
      { label: 'Unified PR diff', path: '/data/workspaces/ws-1/context/pr.diff', checkoutRelativePath: null },
      { label: 'PR metadata (JSON)', path: '/data/workspaces/ws-1/context/pr.json', checkoutRelativePath: null },
      { label: 'Detected technologies (JSON)', path: '/data/workspaces/ws-1/context/technologies.json', checkoutRelativePath: null },
    ]);
  });

  it('handles a checkout that is not inside the workspace root at all', () => {
    const layout = resolveWorkspaceLayout(
      prepared({ rootPath: '/data/workspaces/ws-1', checkoutPath: '/srv/checkouts/ws-1' }),
    );

    expect(layout.checkoutRoot).toBe('/srv/checkouts/ws-1');
    expect(layout.readOnlyDirectories).toEqual(['/data/workspaces/ws-1']);
  });

  it('adds the directory of a standards snapshot that lives outside the workspace', () => {
    const layout = resolveWorkspaceLayout(prepared({}), '/data/standards/abc123/STANDARDS.md');

    expect(layout.readOnlyDirectories).toEqual(['/data/workspaces/ws-1', '/data/standards/abc123']);
    expect(layout.contextFiles.at(-1)).toEqual({
      label: 'Project standards snapshot',
      path: '/data/standards/abc123/STANDARDS.md',
      checkoutRelativePath: null,
    });
  });

  it('needs no extra directories when every context file is inside the checkout', () => {
    const layout = resolveWorkspaceLayout(
      prepared({
        rootPath: '/w',
        checkoutPath: '/w',
        diffPath: '/w/.pr-review/pr.diff',
        metadataPath: '/w/.pr-review/pr.json',
        technologyManifestPath: '/w/.pr-review/tech.json',
      }),
    );

    expect(layout.readOnlyDirectories).toEqual([]);
    expect(layout.contextFiles[0]).toEqual({
      label: 'Unified PR diff',
      path: '/w/.pr-review/pr.diff',
      checkoutRelativePath: '.pr-review/pr.diff',
    });
  });

  it('resolves Windows paths case-insensitively, across drives, with either separator', () => {
    const layout = resolveWorkspaceLayout(
      prepared({
        rootPath: 'C:\\Users\\Dev\\AppData\\Local\\PrOrchestrator\\workspaces\\7f3a',
        checkoutPath: 'D:\\reviews\\7f3a\\repo\\',
        diffPath: 'c:/users/dev/appdata/local/prorchestrator/workspaces/7f3a/pr.diff',
        metadataPath: 'C:\\Users\\Dev\\AppData\\Local\\PrOrchestrator\\workspaces\\7f3a\\pr.json',
        technologyManifestPath: 'D:\\reviews\\7f3a\\repo\\.context\\tech.json',
      }),
      'C:\\Users\\Dev\\AppData\\Local\\PrOrchestrator\\standards\\abc\\STANDARDS.md',
    );

    expect(layout.flavor).toBe('win32');
    expect(layout.checkoutRoot).toBe('D:\\reviews\\7f3a\\repo');
    expect(layout.readOnlyDirectories).toEqual([
      'C:\\Users\\Dev\\AppData\\Local\\PrOrchestrator\\workspaces\\7f3a',
      'C:\\Users\\Dev\\AppData\\Local\\PrOrchestrator\\standards\\abc',
    ]);
    expect(layout.contextFiles.map((file) => [file.path, file.checkoutRelativePath])).toEqual([
      ['c:\\users\\dev\\appdata\\local\\prorchestrator\\workspaces\\7f3a\\pr.diff', null],
      ['C:\\Users\\Dev\\AppData\\Local\\PrOrchestrator\\workspaces\\7f3a\\pr.json', null],
      ['D:\\reviews\\7f3a\\repo\\.context\\tech.json', '.context/tech.json'],
      ['C:\\Users\\Dev\\AppData\\Local\\PrOrchestrator\\standards\\abc\\STANDARDS.md', null],
    ]);
  });

  it('does not treat a sibling directory with a shared prefix as inside the checkout', () => {
    const layout = resolveWorkspaceLayout(
      prepared({ checkoutPath: '/w/repo', rootPath: '/w', diffPath: '/w/repo-context/pr.diff' }),
    );

    expect(layout.contextFiles[0]?.checkoutRelativePath).toBeNull();
  });

  it.each([
    ['a relative checkout path', { checkoutPath: 'checkout' }],
    ['a missing checkout path', { checkoutPath: '' }],
    ['a relative context path', { diffPath: 'pr.diff' }],
    ['mixed Windows and POSIX paths', { diffPath: 'C:\\w\\pr.diff' }],
    ['a UNC checkout', { rootPath: '\\\\server\\share\\ws', checkoutPath: '\\\\server\\share\\ws\\repo', diffPath: '\\\\server\\share\\ws\\pr.diff', metadataPath: '\\\\server\\share\\ws\\pr.json', technologyManifestPath: '\\\\server\\share\\ws\\t.json' }],
  ] as const)('rejects %s', (_name, overrides) => {
    expect(() => resolveWorkspaceLayout(prepared(overrides as Partial<PreparedWorkspace>))).toThrow(WorkspaceLayoutError);
  });
});
