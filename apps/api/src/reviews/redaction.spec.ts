import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CLAUDE,
  CODEX,
  GEMINI,
  acceptAll,
  candidatesFromPrompt,
  completed,
  createHarness,
  failed,
  reviewerJson,
  toWire,
  verifierJson,
  wireFinding,
  type Harness,
  type HarnessOptions,
} from '../../../../tests/fixtures/fake-clis/orchestrator-harness.js';
import { SYNTHETIC_KNOWN_SECRET, SYNTHETIC_SECRETS as S } from '../../../../tests/fixtures/fake-clis/synthetic-secrets.js';
import { ReportQueryService } from '../reports/report-query.service.js';
import { ReviewEventsService } from './review-events.service.js';
import { ReviewOrchestratorService } from './review-orchestrator.service.js';
import { ReviewsController } from './reviews.controller.js';

const SECRETS = [...Object.values(S), SYNTHETIC_KNOWN_SECRET];

/** Every raw form in which a secret could appear inside serialized output. */
function leakedSecrets(haystack: string): string[] {
  return SECRETS.filter((secret) => haystack.includes(secret) || haystack.includes(JSON.stringify(secret).slice(1, -1)));
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function setup(options: HarnessOptions) {
  const h: Harness = await createHarness({ secretValues: [SYNTHETIC_KNOWN_SECRET], ...options });
  const moduleRef = await Test.createTestingModule({
    controllers: [ReviewsController],
    providers: [
      { provide: ReviewOrchestratorService, useValue: h.orchestrator },
      { provide: ReviewEventsService, useValue: h.events },
      { provide: ReportQueryService, useValue: new ReportQueryService(h.repository) },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  cleanups.push(async () => {
    await app.close();
    await h.dispose();
  });

  return { h, http: () => request(app.getHttpServer()) };
}

const leakyReviewer = wireFinding({
  title: `Hardcoded key ${S.aws}`,
  evidence: `Line 12 reads \`config.value\` next to ${S.assignment} and ${S.privateKey}`,
  impact: `Anyone can reuse ${S.jwt} and ${S.bearer}`,
  suggestedFix: `Rotate ${S.github} and ${S.githubFineGrained}`,
  reference: `See ${S.urlCredential}`,
  location: { startLine: 12, endLine: 14, description: `near ${S.openAi}` },
});

async function everythingStoredAndDelivered(h: Harness, http: () => request.Agent, id: string, sse: unknown[]): Promise<string> {
  const job = await h.repository.getJob(id);
  const report = await h.repository.getReport(id);
  const api = await http().get(`/api/reviews/${id}`);
  const markdown = await http().get(`/api/reviews/${id}/report.md`);
  const history = await http().get('/api/reviews');

  return JSON.stringify({
    job,
    runs: await h.repository.listRuns(id),
    candidates: await h.repository.listCandidates(id),
    report,
    api: api.body,
    markdown: markdown.text,
    history: history.body,
    sse,
  });
}

describe('redaction of model-authored text before persistence and delivery', () => {
  it('removes secrets from reviewer and verifier output everywhere it is stored or delivered', async () => {
    const { h, http } = await setup({
      scripts: {
        codex: (r) =>
          completed(
            'codex',
            r,
            reviewerJson([leakyReviewer], {
              warnings: [`Saw ${S.slack} in a fixture`, `Known value ${SYNTHETIC_KNOWN_SECRET}`],
              exclusions: [{ path: 'dist/app.js', reason: `Bundle embeds ${S.azurePat}` }],
            }),
          ),
        gemini: (r) =>
          completed('gemini', r, reviewerJson([wireFinding({ title: 'Parser leaks the key', filePath: 'src/parser.ts', evidence: `Line 12 reads \`config.value\` and logs ${SYNTHETIC_KNOWN_SECRET}` })])),
        claude: (r) =>
          completed(
            'claude',
            r,
            verifierJson(
              candidatesFromPrompt(r.prompt).map((candidate) => ({
                candidateIds: [candidate.id],
                verdict: 'accepted' as const,
                rationale: `Confirmed; the value ${S.google} is live`,
                finding: { ...toWire(candidate), impact: `Exposes ${S.openAi}` },
              })),
              `Summary mentions ${S.jwt} and ${SYNTHETIC_KNOWN_SECRET}`,
              [`Verifier saw ${S.aws}`, `Verifier saw ${S.urlCredential}`],
            ),
          ),
      },
    });
    const created = await http().post('/api/reviews').send(h.request({ main: CLAUDE, reviewers: [CODEX, GEMINI] })).expect(201);
    const id = created.body.id as string;
    const sse: unknown[] = [];
    h.events.stream(id, () => new ReportQueryService(h.repository).getReview(id)).subscribe((event) => sse.push(event));
    await h.orchestrator.awaitCompletion(id);

    const everything = await everythingStoredAndDelivered(h, http, id, sse);

    expect((await h.repository.getJob(id))?.state).toBe('completed');
    expect(everything).toContain('[REDACTED]');
    expect(everything).toContain('Hardcoded key');
    expect(leakedSecrets(everything)).toEqual([]);
  });

  it('removes secrets from failure reasons, run warnings, logs and responses of a failed review', async () => {
    let call = 0;
    const { h, http } = await setup({
      scripts: {
        codex: (r) => completed('codex', r, reviewerJson([leakyReviewer])),
        gemini: (r) => failed('gemini', r, `gemini auth failed for ${S.google} / ${SYNTHETIC_KNOWN_SECRET}`),
        claude: (r) => {
          call += 1;

          return call === 1
            ? completed('claude', r, `{"summary": "${S.openAi}", "decisions": "${S.github}"}`, `stderr ${S.slack}`)
            : failed('claude', r, `model refused; token ${S.jwt} ${SYNTHETIC_KNOWN_SECRET}`);
        },
      },
    });
    const created = await http().post('/api/reviews').send(h.request()).expect(201);
    const id = created.body.id as string;
    const sse: unknown[] = [];
    h.events.stream(id, () => new ReportQueryService(h.repository).getReview(id)).subscribe((event) => sse.push(event));
    await h.orchestrator.awaitCompletion(id);

    const job = await h.repository.getJob(id);
    const everything = await everythingStoredAndDelivered(h, http, id, sse);

    expect(job?.state).toBe('failed');
    expect(job?.failureReason).toContain('[REDACTED]');
    expect(leakedSecrets(everything)).toEqual([]);
  });

  it('removes secrets from error responses', async () => {
    const { h, http } = await setup({ scripts: { claude: (r) => completed('claude', r, acceptAll(r.prompt)) } });
    h.providers.blocked.add('codex/cli-default');
    h.providers.blockedMessage = `codex is not ready (error). Login failed with ${S.openAi} ${SYNTHETIC_KNOWN_SECRET}`;

    const response = await http().post('/api/reviews').send(h.request()).expect(422);

    expect(JSON.stringify(response.body)).toContain('[REDACTED]');
    expect(leakedSecrets(JSON.stringify(response.body))).toEqual([]);
  });
});
