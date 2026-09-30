import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { ProviderQuotasResponseSchema } from '@pr-orchestrator/contracts';
import { AuthService } from '../../auth/auth.service.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { ProviderQuotaController } from './quota.controller.js';
import { ProviderQuotaService } from './quota.service.js';
describe('quota HTTP authentication', () => {
  it('protects GET/refresh, enforces origin and returns an additive validated contract', async () => {
    const token = 'a'.repeat(43);
    let reads = 0;
    const service = new ProviderQuotaService([
      {
        provider: 'codex',
        read: async () => {
          reads++;
          return {
            status: 'unavailable',
            reason: 'no_measurement',
            windows: [],
          };
        },
      },
    ]);
    const module = await Test.createTestingModule({
      controllers: [ProviderQuotaController],
      providers: [
        { provide: ProviderQuotaService, useValue: service },
        {
          provide: AuthService,
          useValue: {
            getSession: async (value: string) => ({
              authenticated: value === token,
            }),
          },
        },
        { provide: APP_GUARD, useClass: SessionGuard },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const http = request(app.getHttpServer());
    try {
      expect((await http.get('/api/provider-quotas')).status).toBe(401);
      expect((await http.post('/api/provider-quotas/refresh')).status).toBe(
        401,
      );
      expect(reads).toBe(0);
      expect(
        (
          await http
            .get('/api/provider-quotas')
            .set('Cookie', `pr_session=${token}`)
            .set('Origin', 'http://evil.example')
        ).status,
      ).toBe(401);
      const result = await http
        .post('/api/provider-quotas/refresh')
        .set('Cookie', `pr_session=${token}`);
      expect(result.status).toBe(200);
      expect(ProviderQuotasResponseSchema.safeParse(result.body).success).toBe(
        true,
      );
      expect(
        (
          await http
            .get('/api/provider-quotas')
            .set('Cookie', `pr_session=${token}`)
        ).body,
      ).toEqual(result.body);
      const throttled = await http
        .post('/api/provider-quotas/refresh')
        .set('Cookie', `pr_session=${token}`);
      expect(throttled.status).toBe(429);
      expect(throttled.body.retryAfterSeconds).toBeGreaterThan(0);
      expect(reads).toBe(1);
    } finally {
      await app.close();
    }
  });
});
