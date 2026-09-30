import { describe, expect, it } from 'vitest';

import { validateFindingPath } from './finding-path.validator.js';

const WINDOWS_ROOT = 'C:\\work\\job-1\\checkout';
const POSIX_ROOT = '/work/job-1/checkout';

describe('validateFindingPath', () => {
  it.each([
    ['src/app/a.ts', 'src/app/a.ts'],
    ['src\\app\\a.ts', 'src/app/a.ts'],
    ['./src/app/a.ts', 'src/app/a.ts'],
    ['.\\src\\a.ts', 'src/a.ts'],
    ['src//app///a.ts', 'src/app/a.ts'],
    ['  src/a.ts  ', 'src/a.ts'],
    ['README.md', 'README.md'],
  ])('normalizes relative path %j to %j', (raw, expected) => {
    expect(validateFindingPath(raw, WINDOWS_ROOT)).toEqual({ ok: true, path: expected });
  });

  it('turns absolute paths inside a Windows checkout into relative paths', () => {
    expect(validateFindingPath('C:\\work\\job-1\\checkout\\src\\a.ts', WINDOWS_ROOT)).toEqual({
      ok: true,
      path: 'src/a.ts',
    });
    expect(validateFindingPath('c:/WORK/job-1/checkout/src/a.ts', WINDOWS_ROOT)).toEqual({
      ok: true,
      path: 'src/a.ts',
    });
  });

  it('turns absolute paths inside a POSIX checkout into relative paths', () => {
    expect(validateFindingPath('/work/job-1/checkout/src/a.ts', POSIX_ROOT)).toEqual({
      ok: true,
      path: 'src/a.ts',
    });
  });

  it.each([
    ['../secrets.txt', 'traversal'],
    ['src/../../secrets.txt', 'traversal'],
    ['src\\..\\..\\secrets.txt', 'traversal'],
    ['src/../a.ts', 'traversal'],
    ['%2e%2e/secrets', 'traversal'],
    ['C:\\Windows\\System32\\drivers\\etc\\hosts', 'outside_checkout'],
    ['C:\\work\\job-1\\checkout-evil\\a.ts', 'outside_checkout'],
    ['C:\\work\\job-1\\other\\a.ts', 'outside_checkout'],
    ['/etc/passwd', 'outside_checkout'],
    ['\\\\server\\share\\a.ts', 'outside_checkout'],
    ['C:relative.ts', 'outside_checkout'],
    ['https://example.com/a.ts', 'invalid'],
    ['file:///C:/a.ts', 'invalid'],
    ['src/a.ts\u0000.png', 'invalid'],
    ['src/a\nb.ts', 'invalid'],
    ['', 'invalid'],
    ['   ', 'invalid'],
    ['.', 'invalid'],
    ['src/', 'invalid'],
    ['x'.repeat(2_000), 'invalid'],
  ])('rejects %j as %s', (raw, reason) => {
    const result = validateFindingPath(raw, WINDOWS_ROOT);

    expect(result).toEqual({ ok: false, reason });
  });

  it('rejects the checkout root itself', () => {
    expect(validateFindingPath(WINDOWS_ROOT, WINDOWS_ROOT)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('treats POSIX absolute paths as outside a Windows checkout', () => {
    expect(validateFindingPath('/work/job-1/checkout/a.ts', WINDOWS_ROOT)).toEqual({
      ok: false,
      reason: 'outside_checkout',
    });
  });
});
