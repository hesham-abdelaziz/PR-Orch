import { GitProcessService } from './git-process.service.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const gitPath = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';
describe('Git process lifetime', () => {
  it('injects bearer credentials through process environment without persisted config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-auth-'));
    const service = new GitProcessService(gitPath, () => []);
    try {
      const output = await service.run(['config', '--get', 'http.extraHeader'], root, new AbortController().signal, { value: 'synthetic-cli-token', scheme: 'Bearer' });
      expect(output.trim()).toBe('Authorization: Bearer synthetic-cli-token');
      expect((await service.run(['config', '--get', 'http.followRedirects'], root, new AbortController().signal)).trim()).toBe('false');
      await expect(service.run(['config', '--get', 'http.extraHeader'], root, new AbortController().signal)).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it.each(['output', 'timeout', 'abort'] as const)('kills a real descendant on %s before returning', async reason => {
    const root = await mkdtemp(join(tmpdir(), 'git-tree-'));
    const pidPath = join(root, 'child.pid').replaceAll('\\', '/');
    const service = new GitProcessService(gitPath, () => [], reason === 'timeout' ? 1000 : 120000);
    const started = Date.now();
    const alias = `!"${process.execPath.replaceAll('\\', '/')}" -e 'require("node:fs").writeFileSync(${JSON.stringify(pidPath)},String(process.pid));console.log(process.pid);setTimeout(()=>{},6000)'`;
    const controller = new AbortController();
    let pid: number | undefined;
    try {
      const run = service.run(['-c', `alias.fixture=${alias}`, 'fixture'], process.cwd(), controller.signal, undefined, reason === 'output' ? 1 : 1048576);
      const assertion = expect(run).rejects.toThrow(reason === 'output' ? /hard limit/ : reason === 'timeout' ? /timed out/ : /Cancelled/);
      while (Date.now() - started < 2000) {
        try { pid = Number(await readFile(pidPath, 'utf8')); break; } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
      }
      expect(pid).toBeGreaterThan(0);
      if (reason === 'abort') controller.abort();
      await assertion;
      expect(Date.now() - started).toBeLessThan(5000);
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
      await rm(root, { recursive: true, force: true });
    }
  }, 10000);
});
