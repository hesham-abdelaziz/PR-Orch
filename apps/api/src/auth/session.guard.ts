import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';
export function sessionToken(cookie?: string): string | undefined {
  const values = cookie
    ?.split(';')
    .map((item) => item.trim())
    .filter((item) => item.startsWith('pr_session='));
  if (values?.length !== 1) return undefined;
  const token = values[0]!.slice('pr_session='.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{
        path: string;
        method: string;
        socket: { localPort?: number };
        headers: { cookie?: string; origin?: string; host?: string };
      }>();
    const host = req.headers.host;
    // Reject DNS rebinding and a wrong local service port before public auth routes.
    if (
      !host ||
      !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host) ||
      Number(host.slice(host.lastIndexOf(':') + 1)) !== req.socket.localPort
    )
      throw new UnauthorizedException('Invalid request host');
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      throw new UnauthorizedException('Invalid request origin');
    if (
      (req.method === 'POST' &&
        /^\/api\/auth\/(setup|login)$/.test(req.path)) ||
      (req.method === 'GET' && req.path === '/api/auth/session')
    )
      return true;
    if (
      !(await this.auth.getSession(sessionToken(req.headers.cookie)))
        .authenticated
    )
      throw new UnauthorizedException('Sign in required');
    return true;
  }
}
