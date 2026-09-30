import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileSystemCheckoutInspector, MAX_INSPECTABLE_FILE_BYTES } from './checkout-inspector.js';

let base: string;
let checkout: string;
let outside: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'inspector-'));
  checkout = join(base, 'checkout');
  outside = join(base, 'outside');
  await mkdir(join(checkout, 'src'), { recursive: true });
  await mkdir(join(checkout, '.git'), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(checkout, 'src', 'loader.ts'), 'line one\r\nline two\nline three\n');
  await writeFile(join(checkout, '.git', 'config'), '[core]\n');
  await writeFile(join(outside, 'secret.ts'), 'outside\n');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** Symbolic links need a privilege on Windows; skip those cases where it is missing. */
async function trySymlink(target: string, path: string, type?: 'dir' | 'file' | 'junction'): Promise<boolean> {
  try {
    await symlink(target, path, type);

    return true;
  } catch {
    return false;
  }
}

describe('FileSystemCheckoutInspector', () => {
  it('reads a checkout file and counts CRLF, LF and trailing newlines correctly', async () => {
    const outcome = await new FileSystemCheckoutInspector(checkout).inspect('src/loader.ts');

    expect(outcome).toEqual({ ok: true, file: { path: 'src/loader.ts', lines: ['line one', 'line two', 'line three'] } });
  });

  it.each([
    ['src/missing.ts', 'missing'],
    ['src', 'not_a_file'],
    ['.git/config', 'git_internal'],
    ['../outside/secret.ts', 'outside_checkout'],
  ] as const)('rejects %s as %s', async (path, reason) => {
    expect(await new FileSystemCheckoutInspector(checkout).inspect(path)).toEqual({ ok: false, reason });
  });

  it('rejects files over the inspection limit and binary files', async () => {
    await writeFile(join(checkout, 'big.txt'), 'x'.repeat(MAX_INSPECTABLE_FILE_BYTES + 1));
    await writeFile(join(checkout, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    const inspector = new FileSystemCheckoutInspector(checkout);

    expect(await inspector.inspect('big.txt')).toEqual({ ok: false, reason: 'too_large' });
    expect(await inspector.inspect('logo.png')).toEqual({ ok: false, reason: 'binary' });
  });

  it('rejects a file symlink that points outside the checkout', async (context) => {
    if (!(await trySymlink(join(outside, 'secret.ts'), join(checkout, 'src', 'link.ts'), 'file'))) context.skip();

    expect(await new FileSystemCheckoutInspector(checkout).inspect('src/link.ts')).toEqual({ ok: false, reason: 'outside_checkout' });
  });

  it('rejects a directory link or junction that leads outside the checkout', async (context) => {
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    if (!(await trySymlink(outside, join(checkout, 'vendor'), type))) context.skip();

    expect(await new FileSystemCheckoutInspector(checkout).inspect('vendor/secret.ts')).toEqual({ ok: false, reason: 'outside_checkout' });
  });

  it('accepts a link that stays inside the checkout', async (context) => {
    if (!(await trySymlink(join(checkout, 'src', 'loader.ts'), join(checkout, 'src', 'alias.ts'), 'file'))) context.skip();

    const outcome = await new FileSystemCheckoutInspector(checkout).inspect('src/alias.ts');

    expect(outcome.ok).toBe(true);
  });

  it('treats a dangling link as missing', async (context) => {
    if (!(await trySymlink(join(checkout, 'nowhere.ts'), join(checkout, 'src', 'dangling.ts'), 'file'))) context.skip();

    expect(await new FileSystemCheckoutInspector(checkout).inspect('src/dangling.ts')).toEqual({ ok: false, reason: 'missing' });
  });
});
