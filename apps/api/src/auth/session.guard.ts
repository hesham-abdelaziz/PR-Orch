import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service.js';

export function sessionToken(cookie?: string): string | undefined {
  return cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('pr_session='))?.slice('pr_session='.length);
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ path: string; method: string; headers: { cookie?: string; origin?: string; host?: string } }>();
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new UnauthorizedException('Invalid request origin');
    if (/^\/api\/auth\/(setup|login|session)$/.test(req.path)) return true;
    if (!(await this.auth.getSession(sessionToken(req.headers.cookie))).authenticated) throw new UnauthorizedException('Sign in required');
    return true;
  }
}
