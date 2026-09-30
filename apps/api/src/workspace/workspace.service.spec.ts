import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceService } from './workspace.service.js';
import { pullRequest } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { FakeSecretStore, SecretValuesService } from '../secrets/secret-store.js';
import { parseAzurePrUrl } from '../azure-devops/azure-pr-url.parser.js';

const gitPath = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';
describe('real isolated Git workspace', () => {
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
