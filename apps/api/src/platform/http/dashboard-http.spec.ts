import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createPlatformDataSource } from '../../database/data-source.js';
import { AuthService } from '../../auth/auth.service.js';
import { SessionGuard } from '../../auth/session.guard.js';
import { SettingsService } from '../../settings/settings.service.js';
import { StandardsService } from '../../standards/standards.service.js';
import {
  FakeSecretStore,
  SecretValuesService,
} from '../../secrets/secret-store.js';
import { AuthController } from '../../auth/auth.controller.js';
import {
  SettingsController,
  PLATFORM_AZURE_AUTH_HTTP,
} from '../../settings/settings.controller.js';
import { StandardsController } from '../../standards/standards.controller.js';

describe('dashboard HTTP with persistent SQLite', () => {
  it('protects platform routes, configures account, replaces secrets and standards and revokes sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'http-platform-'));
    const db = await createPlatformDataSource(
      join(root, 'app.sqlite'),
    ).initialize();
    await db.runMigrations();
    const secrets = new SecretValuesService(new FakeSecretStore());
    const module = await Test.createTestingModule({
      controllers: [AuthController, SettingsController, StandardsController],
      providers: [
        { provide: AuthService, useValue: new AuthService(db) },
        { provide: SettingsService, useValue: new SettingsService(db, root) },
        { provide: StandardsService, useValue: new StandardsService(db, root) },
        { provide: SecretValuesService, useValue: secrets },
        {
          provide: PLATFORM_AZURE_AUTH_HTTP,
          useValue: {
            status: async () =>
              (await secrets.getPat())
                ? { method: 'pat', configured: true }
                : {
                    method: 'unavailable',
                    configured: false,
                    reason: 'pat_missing_and_azure_cli_unavailable',
                  },
            test: async () => ({ authenticated: true }),
          },
        },
        { provide: APP_GUARD, useClass: SessionGuard },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    const http = request(app.getHttpServer());
    try {
      expect((await http.get('/api/auth/session')).body).toEqual({
        authenticated: false,
        setupRequired: true,
      });
      expect((await http.get('/api/settings')).status).toBe(401);
      expect(
        (
          await http
            .post('/api/auth/setup')
            .send({ username: 'owner', password: 'short' })
        ).status,
      ).toBe(400);
      const setup = await http
        .post('/api/auth/setup')
        .send({ username: 'owner', password: 'test-password-long' });
      expect(setup.status).toBe(201);
      expect(setup.body.authenticated).toBe(true);
      expect(setup.body.token).toBeUndefined();
      const cookie = String(setup.headers['set-cookie'][0]);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(
        (
          await http
            .post('/api/auth/setup')
            .send({ username: 'other', password: 'test-password-long' })
        ).status,
      ).toBe(409);
      expect(
        (
          await http
            .get('/api/settings')
            .set('Host', 'evil.example')
            .set('Cookie', cookie)
        ).status,
      ).toBe(401);
      expect(
        (
          await http
            .put('/api/settings')
            .set('Origin', 'http://evil.example')
            .set('Cookie', cookie)
            .send({ maxParallelReviewers: 1 })
        ).status,
      ).toBe(401);
      expect(
        (
          await http
            .put('/api/settings')
            .set('Cookie', cookie)
            .send({ maxParallelReviewers: 1 })
        ).body.maxParallelReviewers,
      ).toBe(1);
      expect(
        (
          await http
            .put('/api/settings')
            .set('Cookie', cookie)
            .send({ workspaceRoot: 'outside' })
        ).status,
      ).toBe(400);
      expect(
        (await http.get('/api/standards').set('Cookie', cookie)).body,
      ).toBeNull();
      const first = await http
        .put('/api/standards')
        .set('Cookie', cookie)
        .send({ filename: 'rules.md', content: 'First rules' });
      expect(first.status).toBe(200);
      const second = await http
        .put('/api/standards')
        .set('Cookie', cookie)
        .send({ filename: 'rules.txt', content: 'New rules' });
      expect(second.body.versionId).not.toBe(first.body.versionId);
      expect(
        (await http.get('/api/standards/content').set('Cookie', cookie)).body,
      ).toEqual({ content: 'New rules' });
      expect(
        (
          await http
            .put('/api/standards')
            .set('Cookie', cookie)
            .send({ filename: '../escape.md', content: 'rules' })
        ).status,
      ).toBe(400);
      const pat = 'synthetic-private-pat-for-http';
      const saved = await http
        .put('/api/settings/azure-pat')
        .set('Cookie', cookie)
        .send({ pat });
      expect(saved.body).toEqual({ method: 'pat', configured: true });
      expect(JSON.stringify(saved.body)).not.toContain(pat);
      expect(
        (await http.delete('/api/settings/azure-pat').set('Cookie', cookie))
          .body.configured,
      ).toBe(false);
      expect(secrets.values()).toContain(pat);
      expect(
        (
          await http
            .put('/api/auth/password')
            .set('Cookie', cookie)
            .send({
              currentPassword: 'test-password-long',
              newPassword: 'replacement-password-long',
            })
        ).status,
      ).toBe(204);
      expect(
        (await http.get('/api/settings').set('Cookie', cookie)).status,
      ).toBe(401);
      const login = await http
        .post('/api/auth/login')
        .send({ username: 'owner', password: 'replacement-password-long' });
      expect(login.status).toBe(200);
      expect(
        (
          await http
            .post('/api/auth/logout')
            .set('Cookie', String(login.headers['set-cookie'][0]))
        ).status,
      ).toBe(204);
    } finally {
      await app.close();
      await db.destroy();
      await rm(root, { recursive: true, force: true });
    }
  });
});
