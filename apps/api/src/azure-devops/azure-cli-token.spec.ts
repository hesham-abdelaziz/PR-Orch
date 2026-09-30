import { readAzureCliToken, resolveAzureCli } from './azure-cli-token.js';
import { execFile } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { join } from 'node:path';
vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
vi.mock('node:fs/promises', () => ({ access: vi.fn(), realpath: vi.fn(async (path: string) => path) }));
describe('Azure CLI existing-session reader', () => {
  const root = process.platform === 'win32' ? 'C:\\AzureCLI' : '/opt/azure-cli';
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('PATH', root); vi.stubEnv('AZURE_DEVOPS_EXT_PAT', 'synthetic-environment-pat'); vi.mocked(access).mockResolvedValue(undefined); });
  afterEach(() => vi.unstubAllEnvs());
  it('invokes only get-access-token with no shell, bounded output/time and restricted environment', async () => {
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, callback: (error: null, stdout: string) => void) => { callback(null, 'synthetic-cli-token\n'); }) as typeof execFile);
    expect(await readAzureCliToken()).toBe('synthetic-cli-token');
    const [, args, options] = vi.mocked(execFile).mock.calls[0]!;
    expect(args).toEqual(['account','get-access-token','--resource','499b84ac-1321-427f-aa17-267ca6975798','--query','accessToken','--output','tsv','--only-show-errors']);
    expect(options).toMatchObject({ shell: false, windowsHide: true, timeout: 15000, maxBuffer: 65536 });
    expect((options as { env: Record<string,string> }).env).not.toHaveProperty('AZURE_DEVOPS_EXT_PAT');
  });
  it('rejects multiline output and never returns child diagnostics', async () => {
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, callback: (error: Error | null, stdout: string) => void) => { callback(null, 'synthetic-token\naccount-sensitive-output'); }) as typeof execFile);
    await expect(readAzureCliToken()).rejects.toThrow('Invalid Azure CLI token response');
    vi.mocked(execFile).mockImplementation(((_file: unknown, _args: unknown, _options: unknown, callback: (error: Error | null, stdout: string) => void) => { callback(new Error('account-sensitive-output'), ''); }) as typeof execFile);
    await expect(readAzureCliToken()).rejects.toThrow('Existing Azure CLI session is unavailable');
  });
  it.runIf(process.platform === 'win32')('resolves official az.cmd through its bundled Python with isolated module launch', async () => {
    vi.mocked(access).mockImplementation(async path => { if (String(path).endsWith('az.exe')) throw new Error('missing'); });
    const resolved = await resolveAzureCli();
    expect(resolved).toEqual({ executable: join(root, '..', 'python.exe'), prefix: ['-I','-m','azure.cli'] });
    expect(realpath).toHaveBeenCalledWith(join(root, 'az.cmd'));
  });
  it('rejects relative PATH entries and missing executable without spawning', async () => {
    vi.stubEnv('PATH', 'relative-only'); await expect(readAzureCliToken()).rejects.toThrow('not installed'); expect(execFile).not.toHaveBeenCalled();
  });
});
