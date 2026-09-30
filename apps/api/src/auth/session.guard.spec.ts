import type { ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { SessionGuard, sessionToken } from './session.guard.js';
const token = 'a'.repeat(43);
function context(
  path = '/api/settings',
  method = 'GET',
  host = 'localhost:3100',
  origin?: string,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        path,
        method,
        socket: { localPort: 3100 },
        headers: { host, origin, cookie: `pr_session=${token}` },
      }),
    }),
  } as ExecutionContext;
}
describe('local session boundary', () => {
  it('accepts exactly one correctly shaped opaque session cookie', () => {
    expect(sessionToken(`other=x; pr_session=${token}`)).toBe(token);
    expect(
      sessionToken(`pr_session=${token}; pr_session=${token}`),
    ).toBeUndefined();
    expect(sessionToken('pr_session=invalid')).toBeUndefined();
  });
  it('rejects external hosts and wrong ports before public routes', async () => {
    const getSession = vi.fn();
    const auth = { getSession } as unknown as AuthService;
    const guard = new SessionGuard(auth);
    await expect(
      guard.canActivate(
        context('/api/auth/session', 'GET', 'evil.example:3100'),
      ),
    ).rejects.toThrow('Invalid request host');
    await expect(
      guard.canActivate(context('/api/auth/login', 'POST', '127.0.0.1:3101')),
    ).rejects.toThrow('Invalid request host');
    expect(getSession).not.toHaveBeenCalled();
  });
  it('rejects cross-origin and opaque-origin requests', async () => {
    const guard = new SessionGuard({
      getSession: vi.fn(),
    } as unknown as AuthService);
    await expect(
      guard.canActivate(
        context('/api/auth/setup', 'POST', 'localhost:3100', 'null'),
      ),
    ).rejects.toThrow('Invalid request origin');
    await expect(
      guard.canActivate(
        context(
          '/api/auth/setup',
          'POST',
          'localhost:3100',
          'http://localhost:3101',
        ),
      ),
    ).rejects.toThrow('Invalid request origin');
  });
  it('only opens the exact public route methods', async () => {
    const auth = {
      getSession: vi.fn().mockResolvedValue({ authenticated: false }),
    } as unknown as AuthService;
    const guard = new SessionGuard(auth);
    expect(await guard.canActivate(context('/api/auth/session'))).toBe(true);
    expect(await guard.canActivate(context('/api/auth/setup', 'POST'))).toBe(
      true,
    );
    expect(await guard.canActivate(context('/api/auth/login', 'POST'))).toBe(
      true,
    );
    await expect(
      guard.canActivate(context('/api/auth/setup', 'GET')),
    ).rejects.toThrow('Sign in required');
  });
  it('permits authenticated same-origin loopback requests', async () => {
    const getSession = vi.fn().mockResolvedValue({ authenticated: true });
    const auth = { getSession } as unknown as AuthService;
    const guard = new SessionGuard(auth);
    expect(
      await guard.canActivate(
        context(
          '/api/settings',
          'PUT',
          '127.0.0.1:3100',
          'http://127.0.0.1:3100',
        ),
      ),
    ).toBe(true);
    expect(
      (auth as unknown as { getSession: ReturnType<typeof vi.fn> }).getSession,
    ).toHaveBeenCalledWith(token);
  });
});
