import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { secrets } from 'just-secrets';
import { WindowsCliResolver } from '../apps/api/dist/providers/windows-cli-resolver.js';

const execute = promisify(execFile);
const resolver = new WindowsCliResolver();
const report = { platform: process.platform, node: process.version, providers: {}, credentialStore: 'not_checked', limitations: ['No model invocation; sandbox access to external context directories is not proven.'] };

async function diagnosticNativeShim(name) {
  // Read npm launch targets without executing the shim. This is a smoke diagnostic,
  // not a production discovery override: report engine resolution separately.
  for (const directory of (process.env.PATH ?? '').split(';')) {
    const root = directory.trim().replace(/^"|"$/g, ''); if (!isAbsolute(root)) continue;
    try {
      const content = await readFile(join(root, name + '.cmd'), 'utf8');
      const match = /"%dp0%\\(node_modules\\[^"\r\n]+\.exe)"\s+%\*/i.exec(content);
      if (!match || match[1].split('\\').includes('..')) continue;
      const executablePath = join(root, match[1]);
      if ((await stat(executablePath)).isFile()) return { executablePath, prefixArgs: [] };
    } catch { /* no native npm target */ }
  }
}
async function probe(command, args) {
  try {
    const result = await execute(command.executablePath, [...command.prefixArgs, ...args], { windowsHide: true, timeout: 30000, maxBuffer: 1048576 });
    return { ok: true, text: result.stdout + result.stderr };
  } catch { return { ok: false, text: '' }; }
}
for (const name of ['claude', 'codex', 'gemini']) {
  const engine = resolver.locate(name);
  const command = engine ?? await diagnosticNativeShim(name);
  if (!command) { report.providers[name] = { installed: false, engineDetected: false }; continue; }
  const version = await probe(command, ['--version']);
  const help = await probe(command, name === 'codex' ? ['exec', '--help'] : ['--help']);
  const flags = name === 'claude' ? ['--restricted', '--permission-prompts', '--add-dir', '--json-schema'] : name === 'codex' ? ['--sandbox', '--ephemeral', '--output-schema', '--cd'] : ['--approval-mode', '--output-format', '--include-directories'];
  const item = { installed: true, engineDetected: Boolean(engine), executablePath: command.executablePath, prefixArgs: command.prefixArgs, version: version.ok ? version.text.trim() : 'probe_failed', flags: Object.fromEntries(flags.map(flag => [flag, help.text.includes(flag)])) };
  if (name === 'claude') {
    const auth = await probe(command, ['auth', 'status']);
    try { item.authenticated = Boolean(JSON.parse(auth.text).loggedIn); } catch { item.authenticated = 'unknown'; }
  } else if (name === 'codex') {
    const auth = await probe(command, ['login', 'status']); item.authenticated = auth.ok && /logged in/i.test(auth.text);
  } else item.authenticated = 'unknown_until_run';
  report.providers[name] = item;
}
const namespace = `pr-review-orchestrator-smoke-${randomUUID()}`;
try {
  await secrets.set({ service: namespace, name: 'probe', value: 'synthetic-smoke-value' });
  report.credentialStore = await secrets.get({ service: namespace, name: 'probe' }) === 'synthetic-smoke-value' ? 'passed' : 'failed';
} catch { report.credentialStore = 'unavailable'; }
finally { try { await secrets.delete({ service: namespace, name: 'probe' }); } catch { report.credentialCleanup = 'failed'; } }
console.log(JSON.stringify(report, null, 2));
if (process.platform !== 'win32' || report.credentialStore !== 'passed' || Object.values(report.providers).some(provider => !provider.engineDetected)) process.exitCode = 1;
