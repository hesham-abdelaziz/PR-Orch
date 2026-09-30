import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { FakeSecretStore } from './secrets/secret-store.js';
import {
  createLocalApplication,
  runtimeOptions,
  locateGit,
} from './bootstrap.js';
import { PLATFORM_DATABASE } from './platform/platform.module.js';
import type { DataSource } from 'typeorm';

describe('local application startup', () => {
  it('binds IPv4 loopback, exposes the platform routes, and preserves sessions after shutdown', async () => {
    const root = await mkdtemp(join(tmpdir(), 'local-startup-'));
    const options = {
      dataRoot: root,
      gitExecutable:
        process.platform === 'win32'
          ? 'C:/Program Files/Git/cmd/git.exe'
          : '/usr/bin/git',
      secretStore: new FakeSecretStore(),
    };
    await mkdir(join(root, 'workspaces', 'job-orphan'), { recursive: true });
    const webRoot = join(root, '.web');
    await mkdir(webRoot);
    await writeFile(
      join(webRoot, 'index.html'),
      '<!doctype html><html><body>Dashboard fixture<script>console.log("csp-fixture");</script></body></html>',
    );
    let app = await createLocalApplication({ ...options, webRoot });
    try {
      await expect(
        stat(join(root, 'workspaces', 'job-orphan')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(createLocalApplication(options)).rejects.toThrow(
        'already running',
      );
      await app.listen(0, '127.0.0.1');
      expect((app.getHttpServer().address() as AddressInfo).address).toBe(
        '127.0.0.1',
      );
      expect(
        (await request(app.getHttpServer()).get('/settings')).text,
      ).toContain('Dashboard fixture');
      const page = await request(app.getHttpServer()).get('/settings');
      expect(page.headers['content-security-policy']).toContain(
        "'sha256-XkJRIO9A6JZW2YgxdDlMslUndybtnfEgEwy6cEF4/ZU='",
      );
      expect(
        page.headers['content-security-policy']
          .split(';')
          .find((part: string) => part.trim().startsWith('script-src')),
      ).not.toContain('unsafe-inline');
      expect(
        (
          await request(app.getHttpServer())
            .get('/settings')
            .set('Host', 'evil.example')
        ).status,
      ).toBe(401);
      expect(
        (await request(app.getHttpServer()).get('/api/missing')).status,
      ).toBe(404);
      expect(
        (await request(app.getHttpServer()).get('/api/auth/session')).body,
      ).toEqual({ authenticated: false, setupRequired: true });
      const setup = await request(app.getHttpServer())
        .post('/api/auth/setup')
        .send({ username: 'local', password: 'long-synthetic-password' });
      expect(setup.status).toBe(201);
      const cookie = setup.headers['set-cookie'][0].split(';')[0];
      expect(setup.headers['set-cookie'][0]).toContain('HttpOnly');
      const settings = await request(app.getHttpServer())
        .get('/api/settings')
        .set('Cookie', cookie);
      expect(settings.status).toBe(200);
      expect(settings.headers['cache-control']).toBe('no-store');
      expect(settings.headers['access-control-allow-origin']).toBeUndefined();
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/reviews/active')
            .set('Cookie', cookie)
        ).status,
      ).toBe(204);
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/settings')
            .set('Host', 'evil.example')
            .set('Cookie', cookie)
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/auth/login')
            .set('Origin', 'https://evil.example')
            .send({ username: 'local', password: 'long-synthetic-password' })
        ).status,
      ).toBe(401);
      const db = app.get<DataSource>(PLATFORM_DATABASE);
      await app.close();
      expect(db.isInitialized).toBe(false);
      app = await createLocalApplication(options);
      await app.listen(0, '127.0.0.1');
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/auth/session')
            .set('Cookie', cookie)
        ).body.authenticated,
      ).toBe(true);
      expect(
        (
          await request(app.getHttpServer())
            .post('/api/pull-requests/validate')
            .set('Cookie', cookie)
            .send({ url: 'https://evil.example/pr/1' })
        ).status,
      ).toBe(400);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it('uses persistent local application data and refuses invalid ports', () => {
    expect(
      runtimeOptions({ LOCALAPPDATA: 'C:/LocalAppData' }).dataRoot,
    ).toContain('pr-review-orchestrator');
    expect(() => runtimeOptions({ PORT: '-1' })).toThrow('port');
    expect(() => runtimeOptions({ PORT: '3000evil' })).toThrow('port');
  });
  it.skipIf(process.platform !== 'win32')(
    'finds native Git from a copied Windows Path environment',
    () => {
      expect(
        locateGit({ Path: 'C:/Program Files/Git/cmd' }).toLowerCase(),
      ).toContain('git.exe');
    },
  );
});
