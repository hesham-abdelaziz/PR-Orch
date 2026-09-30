import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { REVIEW_PROVIDER_PORT } from '../reviews/review-ports.js';
import {
  REVIEW_REPOSITORY,
  type ReviewRepository,
} from '../reviews/review-repository.js';
import { ReviewOrchestratorService } from '../reviews/review-orchestrator.service.js';
import { FakeSecretStore } from '../secrets/secret-store.js';
import { PLATFORM_DATABASE } from './platform.module.js';
import { pullRequest } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import {
  acceptAll,
  reviewerJson,
  wireFinding,
} from '../../../../tests/fixtures/fake-clis/orchestrator-harness.js';
import type { ProviderRunRequest } from '../providers/provider-adapter.js';
import type { DataSource } from 'typeorm';

describe('runnable backend HTTP lifecycle', () => {
  it('creates through HTTP, enforces one job, snapshots standards, returns both reports and shuts down an active job before SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'backend-lifecycle-'));
    const fixture = join(root, 'fixture');
    await mkdir(fixture);
    const executable =
      process.platform === 'win32'
        ? 'C:/Program Files/Git/cmd/git.exe'
        : '/usr/bin/git';
    const git = (...args: string[]) =>
      execFileSync(executable, args, {
        cwd: fixture,
        encoding: 'utf8',
        windowsHide: true,
      });
    git('init');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    await mkdir(join(fixture, 'src'));
    await writeFile(
      join(fixture, 'src', 'loader.ts'),
      Array.from({ length: 20 }, () => 'const value = config.value;').join(
        '\n',
      ),
    );
    git('add', '.');
    git('commit', '-m', 'fixture');
    const commit = git('rev-parse', 'HEAD').trim();
    const pr = { ...pullRequest(), sourceCommit: commit, targetCommit: commit };
    let release!: () => void;
    let blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    let observed = new Promise<void>((resolve) => {
      started = resolve;
    });
    let cancel = () => release();
    const fake = {
      async runReview(input: ProviderRunRequest) {
        if (input.prompt.includes('CANDIDATE_FINDINGS'))
          return {
            status: 'completed',
            rawOutput: acceptAll(input.prompt),
            stderr: '',
            durationMs: 1,
          };
        started();
        await blocked;
        return {
          status: 'completed',
          rawOutput: reviewerJson([
            wireFinding({ evidence: 'Line 12 reads `config.value`.' }),
          ]),
          stderr: '',
          durationMs: 1,
        };
      },
      async cancel() {
        cancel();
      },
    };
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          dataRoot: root,
          gitExecutable: executable,
          secretStore: new FakeSecretStore(),
          validatePullRequest: async () => pr,
          remoteForPullRequest: () => fixture,
        }),
      ],
    })
      .overrideProvider(REVIEW_PROVIDER_PORT)
      .useValue({ assertSelectable: async () => {}, getAdapter: () => fake })
      .compile();
    const app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
    const http = request(app.getHttpServer());
    try {
      const account = await http
        .post('/api/auth/setup')
        .send({ username: 'owner', password: 'synthetic-password-long' });
      const cookie = account.headers['set-cookie'][0];
      const first = await http
        .put('/api/standards')
        .set('Cookie', cookie)
        .send({ filename: 'first.md', content: 'First standards' });
      const body = {
        pullRequestUrl: pr.url,
        main: { provider: 'claude', model: 'cli-default' },
        reviewers: [{ provider: 'codex', model: 'cli-default' }],
      };
      const created = await http
        .post('/api/reviews')
        .set('Cookie', cookie)
        .send(body);
      expect(created.status).toBe(201);
      const id = created.body.id;
      await observed;
      const conflict = await http
        .post('/api/reviews')
        .set('Cookie', cookie)
        .send(body);
      expect(conflict.status).toBe(409);
      expect(conflict.body.activeReviewId).toBe(id);
      await http
        .put('/api/standards')
        .set('Cookie', cookie)
        .send({ filename: 'second.md', content: 'Second standards' });
      release();
      await app.get(ReviewOrchestratorService).awaitCompletion(id);
      const completed = await http
        .get(`/api/reviews/${id}`)
        .set('Cookie', cookie);
      expect(completed.body.state).toBe('completed');
      expect(completed.body.standards.versionId).toBe(first.body.versionId);
      expect((await http.get(`/api/reviews/${id}/report`)).status).toBe(401);
      const report = await http
        .get(`/api/reviews/${id}/report`)
        .set('Cookie', cookie);
      expect(report.status).toBe(200);
      expect(report.body.findings).toHaveLength(1);
      expect(
        (await http.get(`/api/reviews/${id}/report.md`).set('Cookie', cookie))
          .text,
      ).toContain(first.body.sha256);
      const history = await http.get('/api/reviews').set('Cookie', cookie);
      expect(history.body.items[0].review.id).toBe(id);
      const repo = app.get<ReviewRepository>(REVIEW_REPOSITORY);
      const stored = await repo.getJob(id);
      expect(await readFile(stored!.standardsStoragePath!, 'utf8')).toBe(
        'First standards',
      );
      blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      observed = new Promise<void>((resolve) => {
        started = resolve;
      });
      cancel = () => release();
      const active = await http
        .post('/api/reviews')
        .set('Cookie', cookie)
        .send(body);
      await observed;
      const db = app.get<DataSource>(PLATFORM_DATABASE);
      await app.close();
      expect(db.isInitialized).toBe(false);
      // Persisted cancellation proves engine destroy completed before database shutdown.
      const { createPlatformDataSource } =
        await import('../database/data-source.js');
      const restored = await createPlatformDataSource(
        join(root, 'orchestrator.sqlite'),
      ).initialize();
      try {
        expect(
          (
            await restored.query('SELECT state FROM review_jobs WHERE id=?', [
              active.body.id,
            ])
          )[0].state,
        ).toBe('cancelled');
      } finally {
        await restored.destroy();
      }
    } finally {
      release();
      await app.close();
      await delay(10);
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
