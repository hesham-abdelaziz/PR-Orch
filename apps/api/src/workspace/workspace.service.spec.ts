import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceService } from './workspace.service.js';
import { pullRequest } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { FakeSecretStore, SecretValuesService } from '../secrets/secret-store.js';
import { parseAzurePrUrl } from '../azure-devops/azure-pr-url.parser.js';
import { DEFAULT_SETTINGS } from '@pr-orchestrator/contracts';
import { readdir } from 'node:fs/promises';
import { GitProcessService } from './git-process.service.js';

const gitPath = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';
describe('real isolated Git workspace', () => {
  it('deepens pinned divergent history and prepares only source changes with source context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-divergence-'));
    const fixture = join(root, 'fixture'); await mkdir(fixture);
    const git = (...args: string[]) => execFileSync(gitPath, args, { cwd: fixture, encoding: 'utf8', windowsHide: true });
    try {
      git('init'); git('config', 'core.autocrlf', 'false'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
      await writeFile(join(fixture, 'base.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
      const base = git('rev-parse', 'HEAD').trim();
      await writeFile(join(fixture, 'target.txt'), 'target only\n'); git('add', '.'); git('commit', '-m', 'target');
      const targetCommit = git('rev-parse', 'HEAD').trim(); git('checkout', '--detach', base);
      await writeFile(join(fixture, 'source.txt'), 'source only\n'); git('add', '.'); git('commit', '-m', 'source');
      let sourceCommit = git('rev-parse', 'HEAD').trim();
      // Force more than one deepening round, without changing the source tree.
      const tree = git('rev-parse', 'HEAD^{tree}').trim();
      for (let i = 0; i < 40; i++) sourceCommit = git('commit-tree', tree, '-p', sourceCommit, '-m', `source history ${i}`).trim();
      git('update-ref', 'refs/heads/source', sourceCommit);
      const settings = structuredClone(DEFAULT_SETTINGS); settings.limits.hardChangedFiles = 1;
      const service = new WorkspaceService(join(root, 'workspaces'), gitPath, new SecretValuesService(new FakeSecretStore()), () => fixture, async () => settings);
      const input = { reviewId: 'test', pullRequest: { ...pullRequest(), sourceCommit, targetCommit, changedFiles: 1 }, standards: null };
      const prepared = await service.prepare(input, new AbortController().signal);
      const patch = await readFile(prepared.diffPath, 'utf8');
      expect(patch).toContain('+source only'); expect(patch).not.toContain('target.txt');
      expect(execFileSync(gitPath, ['rev-parse', 'HEAD'], { cwd: prepared.checkoutPath, encoding: 'utf8' }).trim()).toBe(sourceCommit);
      const metadata = JSON.parse(await readFile(prepared.metadataPath, 'utf8'));
      expect(metadata).toMatchObject({ sourceCommit, targetCommit, commonAncestorCommit: base, comparisonMode: 'merge-base-to-source', changedFiles: ['source.txt'] });
      expect([...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map(match => match[2])).toEqual(metadata.changedFiles);
      expect(prepared.exclusions).toEqual([]);
      const overreported = await service.prepare({ ...input, pullRequest: { ...input.pullRequest, changedFiles: 99 } }, new AbortController().signal);
      expect(overreported.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/1 paths.*99 tracked changes/)]));
      await service.cleanup(overreported.workspaceId);
      settings.limits.hardDiffBytes = 1;
      await expect(service.prepare(input, new AbortController().signal)).rejects.toThrow(/hard limit/);
      settings.limits.hardDiffBytes = DEFAULT_SETTINGS.limits.hardDiffBytes;
      settings.limits.hardInspectableFileBytes = 1;
      await expect(service.prepare(input, new AbortController().signal)).rejects.toThrow(/hard size limit/);
      settings.limits.hardInspectableFileBytes = DEFAULT_SETTINGS.limits.hardInspectableFileBytes;
      const controller = new AbortController(); controller.abort();
      await expect(service.prepare(input, controller.signal)).rejects.toThrow(/Cancelled/);
      const duringFetch = new AbortController();
      // oxlint-disable-next-line typescript/unbound-method -- Called below with the original GitProcessService receiver.
      const realRun = GitProcessService.prototype.run;
      const spy = vi.spyOn(GitProcessService.prototype, 'run').mockImplementation(function (this: GitProcessService, args, cwd, signal, credential, maxBytes) {
        if (args[0] === 'fetch' && args.includes('--depth=32')) duringFetch.abort();
        return realRun.call(this, args, cwd, signal, credential, maxBytes);
      });
      try { await expect(service.prepare(input, duringFetch.signal)).rejects.toThrow(/Cancelled/); }
      finally { spy.mockRestore(); }
      await writeFile(join(fixture, 'extra.txt'), 'extra source change\n'); git('add', '.'); git('commit', '-m', 'extra source');
      await expect(service.prepare({ ...input, pullRequest: { ...input.pullRequest, sourceCommit: git('rev-parse', 'HEAD').trim() } }, new AbortController().signal)).rejects.toThrow(/changed-file hard limit/);
      git('checkout', '--orphan', 'unrelated'); git('rm', '-rf', '.');
      await writeFile(join(fixture, 'unrelated.txt'), 'unrelated\n'); git('add', '.'); git('commit', '-m', 'unrelated');
      await expect(service.prepare({ ...input, pullRequest: { ...input.pullRequest, targetCommit: git('rev-parse', 'HEAD').trim() } }, new AbortController().signal)).rejects.toThrow(/common ancestor.*pinned.*history/i);
      expect(await readdir(join(root, 'workspaces'))).toEqual([prepared.workspaceId]);
    } finally { await rm(root, { recursive: true, force: true }); }
  }, 30000);
  it('prepares separate context and checkout, strips fetch auth, excludes lockfiles, and cleans idempotently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-integration-')); const fixture = join(root, 'fixture');
    await mkdir(fixture); const git = (...args: string[]) => execFileSync(gitPath, args, { cwd: fixture, encoding: 'utf8', windowsHide: true });
    try {
      git('init'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
      await mkdir(join(fixture, 'src')); await writeFile(join(fixture, 'src', 'loader.ts'), 'const config = null;\n');
      git('add', '.'); git('commit', '-m', 'target'); const targetCommit = git('rev-parse', 'HEAD').trim();
      await writeFile(join(fixture, 'src', 'loader.ts'), 'const config = null;\nconsole.log(config.value);\n');
      await writeFile(join(fixture, 'package-lock.json'), '{}');
      git('add', '.'); git('commit', '-m', 'source'); const sourceCommit = git('rev-parse', 'HEAD').trim();
      const secrets = new SecretValuesService(new FakeSecretStore()); await secrets.setPat('synthetic-pat-value');
      const service = new WorkspaceService(join(root, 'workspaces'), gitPath, secrets, () => fixture);
      const prepared = await service.prepare({ reviewId: 'test', pullRequest: { ...pullRequest(), sourceCommit, targetCommit }, standards: null }, new AbortController().signal);
      expect(prepared.checkoutPath).toBe(join(prepared.rootPath, 'checkout'));
      expect(await readFile(join(prepared.checkoutPath, 'src', 'loader.ts'), 'utf8')).toContain('config.value');
      expect(await readFile(prepared.diffPath, 'utf8')).toContain('+console.log(config.value)');
      const config = await readFile(join(prepared.checkoutPath, '.git', 'config'), 'utf8');
      expect(config).not.toContain('synthetic-pat-value'); expect(config).not.toMatch(/extraheader|credential/i);
      expect(config).toContain('DISABLED');
      expect(prepared.exclusions).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'package-lock.json' })]));
      expect(prepared.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/standards/i)]));
      await service.cleanup(prepared.workspaceId); await service.cleanup(prepared.workspaceId);
      await expect(service.cleanup('../fixture')).rejects.toThrow();
      expect(git('rev-parse', 'HEAD').trim()).toBe(sourceCommit);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
describe('Azure URL trust boundary', () => {
  it('accepts the canonical URL and decodes identifiers', () => {
    expect(parseAzurePrUrl('https://dev.azure.com/org/My%20Project/_git/repo/pullrequest/12')).toEqual({ organization: 'org', project: 'My Project', repository: 'repo', pullRequestId: 12 });
  });
  it.each(['https://evil.invalid/org/project/_git/repo/pullrequest/1', 'https://dev.azure.com/org/%2e%2e/_git/repo/pullrequest/1', 'https://dev.azure.com/org/%252e%252e/_git/repo/pullrequest/1', 'https://dev.azure.com/org/project/_git/a%2fb/pullrequest/1', 'https://user:pass@dev.azure.com/org/project/_git/repo/pullrequest/1', 'http://dev.azure.com/org/project/_git/repo/pullrequest/1'])('rejects malicious URL %s', url => { expect(() => parseAzurePrUrl(url)).toThrow(); });
});
