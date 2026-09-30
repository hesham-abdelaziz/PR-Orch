import { execFile } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

/** Reads the existing Entra session only; never runs login or extension/config commands. */
export async function resolveAzureCli(): Promise<{ executable: string; prefix: string[] }> {
  const names = process.platform === 'win32' ? ['az.exe', 'az.cmd'] : ['az'];
  for (const directory of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!isAbsolute(directory)) continue;
    for (const name of names) {
      const candidate = join(directory, name);
      try { await access(candidate); } catch { continue; }
      let executable = await realpath(candidate); let prefix: string[] = [];
      if (executable.toLowerCase().endsWith('.cmd')) {
        // Official Windows MSI packages place python.exe beside the Scripts directory.
        executable = join(dirname(dirname(executable)), 'python.exe');
        try { await access(executable); } catch { continue; }
        prefix = ['-I', '-m', 'azure.cli'];
      }
      return { executable, prefix };
    }
  }
  throw new Error('Azure CLI is not installed');
}
export async function readAzureCliToken(): Promise<string> {
      const { executable, prefix } = await resolveAzureCli();
      const env: Record<string, string> = { AZURE_CORE_COLLECT_TELEMETRY: 'false', AZURE_CORE_ONLY_SHOW_ERRORS: 'true', AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no' };
      for (const key of ['PATH','SystemRoot','WINDIR','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','TEMP','TMP','AZURE_CONFIG_DIR']) if (process.env[key]) env[key] = process.env[key]!;
      return new Promise((resolve, reject) => {
        execFile(executable, [...prefix, 'account', 'get-access-token', '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--query', 'accessToken', '--output', 'tsv', '--only-show-errors'], { env, shell: false, windowsHide: true, timeout: 15000, maxBuffer: 65536 }, (error, stdout) => {
          if (error) { reject(new Error('Existing Azure CLI session is unavailable')); return; }
          const token = stdout.trim();
          if (!token || token.length > 16384 || /\s/.test(token)) reject(new Error('Invalid Azure CLI token response')); else resolve(token);
        });
      });
}
