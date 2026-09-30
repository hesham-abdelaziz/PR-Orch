import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import {
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  SetupAccountRequestSchema,
} from '@pr-orchestrator/contracts';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { sessionToken } from './session.guard.js';
import { parseBody } from '../platform/http/parse-body.js';
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/api',
};
@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  private setSession(
    response: Response,
    result: Awaited<ReturnType<AuthService['login']>>,
  ) {
    response.cookie('pr_session', result.token, {
      ...cookieOptions,
      expires: new Date(
        result.session.authenticated ? result.session.expiresAt : 0,
      ),
    });
    return result.session;
  }
  @Post('setup')
  async setup(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.setSession(
      response,
      await this.auth.setup(parseBody(SetupAccountRequestSchema, body)),
    );
  }
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.setSession(
      response,
      await this.auth.login(parseBody(LoginRequestSchema, body)),
    );
  }
  @Get('session')
  session(@Req() req: Request) {
    return this.auth.getSession(sessionToken(req.headers.cookie));
  }
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(sessionToken(req.headers.cookie));
    response.clearCookie('pr_session', cookieOptions);
  }
  @Put('password')
  @HttpCode(204)
  async password(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.changePassword(
      sessionToken(req.headers.cookie) ?? '',
      parseBody(ChangePasswordRequestSchema, body),
    );
    response.clearCookie('pr_session', cookieOptions);
  }
}
