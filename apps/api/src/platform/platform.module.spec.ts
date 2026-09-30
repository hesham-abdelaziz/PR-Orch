import { Test } from '@nestjs/testing';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { firstValueFrom } from 'rxjs';
import { PlatformModule, PLATFORM_DATABASE } from './platform.module.js';
import { ReviewsModule } from '../reviews/reviews.module.js';
import { ReviewOrchestratorService } from '../reviews/review-orchestrator.service.js';
import { REVIEW_PROVIDER_PORT } from '../reviews/review-ports.js';
import { REVIEW_REPOSITORY, type ReviewRepository } from '../reviews/review-repository.js';
import { ReviewEventsService } from '../reviews/review-events.service.js';
import { ProviderRegistryService } from '../providers/provider-registry.service.js';
import { ProviderNotSelectableError } from '../providers/provider-registry.service.js';
import { buildClaudeReviewArgs, buildCodexReviewArgs, buildGeminiReviewArgs } from '../providers/adapters/adapter-command-policy.js';
import { AuthService } from '../auth/auth.service.js';
import { SecretValuesService, FakeSecretStore } from '../secrets/secret-store.js';
import { pullRequest } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { acceptAll, reviewerJson, wireFinding } from '../../../../tests/fixtures/fake-clis/orchestrator-harness.js';
import type { ProviderRunRequest, ProviderAdapter } from '../providers/provider-adapter.js';
import type { DataSource } from 'typeorm';

describe('Nest platform/engine integration', () => {
  it('wires a real checkout and SQLite repository, redacts the saved PAT, and reconnects SSE after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nest-platform-')); const fixture = join(root, 'fixture'); await mkdir(fixture);
    const gitPath = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : '/usr/bin/git';
    const git = (...args: string[]) => execFileSync(gitPath, args, { cwd: fixture, encoding: 'utf8', windowsHide: true });
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    await mkdir(join(fixture, 'src')); await writeFile(join(fixture, 'src', 'loader.ts'), Array.from({ length: 20 }, () => 'const value = config.value;').join('\n'));
    git('add', '.'); git('commit', '-m', 'source'); const commit = git('rev-parse', 'HEAD').trim();
    const pr = { ...pullRequest(), sourceCommit: commit, targetCommit: commit };
    const pat = 'synthetic-secret-for-platform-integration'; const store = new FakeSecretStore(); await store.set('azure-devops-pat', pat);
    const calls: ProviderRunRequest[] = [];
    let readinessFailure: string | null = null;
    const fake = {
      async runReview(input: ProviderRunRequest) {
        calls.push(input);
        const output = input.prompt.includes('CANDIDATE_FINDINGS') ? JSON.parse(acceptAll(input.prompt)) : JSON.parse(reviewerJson([wireFinding({ evidence: 'Line 12 reads `config.value`.', title: 'Bad value ' + pat })], { warnings: ['secret ' + pat] }));
        if ('summary' in output) { output.summary = 'Summary ' + pat; output.warnings = ['Verifier ' + pat]; output.decisions[0].rationale += ' ' + pat; }
        return { status: 'completed', rawOutput: JSON.stringify(output), stderr: pat, durationMs: 1 };
      }, async cancel() {},
    } as unknown as ProviderAdapter;
    const make = async () => {
      const module = await Test.createTestingModule({ imports: [PlatformModule.forRoot({ dataRoot: root, gitExecutable: gitPath, secretStore: store, validatePullRequest: async () => pr, remoteForPullRequest: () => fixture }), ReviewsModule] })
        .overrideProvider(REVIEW_PROVIDER_PORT).useValue({ assertSelectable: async () => { if (readinessFailure) throw new ProviderNotSelectableError(readinessFailure); }, getAdapter: () => fake })
        .overrideProvider(ProviderRegistryService).useValue({ refresh: async () => [], getSnapshot: async () => [] })
        .compile();
      const app = module.createNestApplication(); await app.init(); return app;
    };
    let app = await make();
    try {
      const engine = app.get(ReviewOrchestratorService);
      const created = await engine.createReview({ pullRequestUrl: pr.url, main: { provider: 'claude', model: 'cli-default' }, reviewers: [{ provider: 'codex', model: 'cli-default' }] });
      const repo = app.get<ReviewRepository>(REVIEW_REPOSITORY); let job;
      for (let i = 0; i < 150; i++) { job = await repo.getJob(created.id); if (job?.state === 'completed' || job?.state === 'failed') break; await delay(50); }
      expect(job?.state).toBe('completed');
      expect(calls).toHaveLength(2);
      expect(calls.every(call => call.workspacePath.endsWith('checkout'))).toBe(true);
      expect(calls.every(call => (call.readOnlyDirectories ?? []).some(path => !path.endsWith('checkout')))).toBe(true);
      const context = calls[0]!.readOnlyDirectories!;
      const claudeArgs = buildClaudeReviewArgs({ model: 'cli-default', schemaJson: '{}', readOnlyDirectories: context });
      expect(claudeArgs[claudeArgs.indexOf('--add-dir') + 1]).toBe(context[0]);
      const geminiArgs = buildGeminiReviewArgs({ model: 'cli-default', sandbox: false, readOnlyDirectories: context });
      expect(geminiArgs[geminiArgs.indexOf('--include-directories') + 1]).toBe(context.join(','));
      const codexArgs = buildCodexReviewArgs({ model: 'cli-default', schemaPath: calls[0]!.outputSchemaPath, workspacePath: calls[0]!.workspacePath });
      expect(codexArgs[codexArgs.indexOf('--cd') + 1]).toBe(calls[0]!.workspacePath);
      expect(codexArgs).not.toContain('--add-dir');
      expect(JSON.stringify(calls.map(call => call.prompt))).not.toContain(pat);
      const db = app.get<DataSource>(PLATFORM_DATABASE);
      for (const table of ['review_jobs', 'candidate_findings', 'final_findings', 'reviewer_runs', 'reports']) expect(JSON.stringify(await db.query(`SELECT * FROM ${table}`))).not.toContain(pat);
      const final = await db.query('SELECT verification FROM final_findings'); expect(JSON.parse(final[0].verification).evidenceLine).toBeGreaterThan(0);
      const response = await request(app.getHttpServer()).get(`/api/reviews/${created.id}`);
      expect(response.status).toBe(401); expect(JSON.stringify(response.body)).not.toContain(pat);
      const sequence = await repo.getEventSequence(created.id); expect(sequence).toBeGreaterThan(0);
      const account = await app.get(AuthService).setup({ username: 'test', password: 'synthetic-password-for-tests' });
      await app.listen(0, '127.0.0.1');
      readinessFailure = 'Provider error includes ' + pat;
      const errorResponse = await request(app.getHttpServer()).post('/api/reviews').set('Cookie', `pr_session=${account.token}`).send({ pullRequestUrl: pr.url, main: { provider: 'claude', model: 'cli-default' }, reviewers: [{ provider: 'codex', model: 'cli-default' }] });
      expect(errorResponse.status).toBe(422); expect(JSON.stringify(errorResponse.body)).not.toContain(pat);
      readinessFailure = null;
      const beforeRestart = await fetch(`${await app.getUrl()}/api/reviews/${created.id}/events`, { headers: { cookie: `pr_session=${account.token}` } });
      expect(beforeRestart.status).toBe(200);
      const beforeText = await beforeRestart.text(); expect(beforeText).toContain(`"sequence":${sequence}`); expect(beforeText).not.toContain(pat);
      await app.close(); app = await make();
      await app.listen(0, '127.0.0.1');
      const afterRestart = await fetch(`${await app.getUrl()}/api/reviews/${created.id}/events`, { headers: { cookie: `pr_session=${account.token}` } });
      expect(afterRestart.status).toBe(200);
      const afterText = await afterRestart.text(); expect(afterText).toContain(`"sequence":${sequence}`); expect(afterText).not.toContain(pat);
      const restored = app.get<ReviewRepository>(REVIEW_REPOSITORY);
      const events = app.get(ReviewEventsService);
      const snapshot = await firstValueFrom(events.stream(created.id, async () => {
        const { toReviewJob } = await import('../reviews/review-job.mapper.js');
        return toReviewJob((await restored.getJob(created.id))!, await restored.listRuns(created.id));
      }));
      expect(snapshot.sequence).toBe(sequence); expect(JSON.stringify(snapshot)).not.toContain(pat);
      expect(await restored.allocateEventSequence(created.id)).toBe(sequence! + 1);
      expect(app.get(SecretValuesService).values()).toContain(pat);
    } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
  }, 30000);
});
