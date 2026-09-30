import { spawn } from 'node:child_process';
import { isAbsolute, win32 } from 'node:path';
import { redactSecrets } from '../providers/redact-secrets.js';
import type { GitCredential } from '../azure-devops/azure-devops.service.js';

export class GitProcessService {
  constructor(private readonly executable: string, private readonly knownSecrets: () => readonly string[], private readonly timeoutMs = 120000) { if (!isAbsolute(executable)) throw new Error('Git executable must be absolute'); }
  run(args: string[], cwd: string, signal: AbortSignal, credential?: string | GitCredential, maxBytes = 6 * 1048576): Promise<string> {
    if (signal.aborted) return Promise.reject(new Error('Cancelled'));
    const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' };
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key]!;
    const auth = typeof credential === 'string' ? { value: credential, scheme: 'Basic' } : credential;
    if (auth) { env.GIT_CONFIG_COUNT = '1'; env.GIT_CONFIG_KEY_0 = 'http.extraHeader'; env.GIT_CONFIG_VALUE_0 = `Authorization: ${auth.scheme} ${auth.scheme === 'Basic' ? Buffer.from(':' + auth.value).toString('base64') : auth.value}`; }
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, ['-c', 'core.hooksPath=', '-c', 'credential.helper=', '-c', 'http.followRedirects=false', ...args], { cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32' });
      const stdout: Buffer[] = []; const stderr: Buffer[] = []; let total = 0; let failure: string | null = null; let settled = false; let cleanupTimer: NodeJS.Timeout | undefined;
      const finish = (code: number | null) => {
        if (settled) return;
        settled = true; clearTimeout(timer); clearTimeout(cleanupTimer); signal.removeEventListener('abort', abort);
        child.stdout.destroy(); child.stderr.destroy();
        if (failure) reject(new Error(failure));
        else if (code !== 0) reject(new Error(redactSecrets(Buffer.concat(stderr).toString('utf8'), [...this.knownSecrets(), ...(auth ? [auth.value, Buffer.from(':' + auth.value).toString('base64')] : [])]).slice(0, 1000) || 'Git failed'));
        else resolve(Buffer.concat(stdout).toString('utf8'));
      };
      const terminate = (reason: string) => {
        if (failure || settled) return;
        failure = reason;
        // Kill the tree before the root disappears; Windows cannot recover its descendants afterward.
        if (child.pid) {
          if (process.platform === 'win32') {
            const killer = spawn(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
            const killTimer = setTimeout(() => { killer.kill(); }, 3000);
            killer.once('error', () => { clearTimeout(killTimer); });
            killer.once('close', () => { clearTimeout(killTimer); });
          } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          }
        }
        cleanupTimer = setTimeout(() => { child.kill('SIGKILL'); finish(null); }, 4000);
      };
      const abort = () => terminate('Cancelled');
      const timer = setTimeout(() => terminate('Git execution timed out'), this.timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      child.stdout.on('data', (chunk: Buffer) => { total += chunk.length; if (total <= maxBytes) stdout.push(chunk); else terminate('PR exceeds the diff/output hard limit'); });
      let errorBytes = 0; child.stderr.on('data', (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes <= 4096) stderr.push(chunk); });
      child.once('error', () => { failure ??= 'Git execution failed'; finish(null); });
      child.once('close', finish);
    });
  }
}
