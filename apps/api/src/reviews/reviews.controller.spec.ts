import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReviewEventSchema, ReviewJobSchema } from '@pr-orchestrator/contracts';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import {
  Gate,
  acceptAll,
  completed,
  createHarness,
  failed,
  reviewerJson,
  wireFinding,
  type Harness,
} from '../../../../tests/fixtures/fake-clis/orchestrator-harness.js';
import { ReportQueryService } from '../reports/report-query.service.js';
import { ReviewEventsService } from './review-events.service.js';
import { ReviewOrchestratorService } from './review-orchestrator.service.js';
import { ReviewsController } from './reviews.controller.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function setup(scripts: Parameters<typeof createHarness>[0] = {}) {
  const h: Harness = await createHarness({
    scripts: {
      codex: (r) => completed('codex', r, reviewerJson([wireFinding({ title: 'Codex finding about the loader' })])),
      gemini: (r) => completed('gemini', r, reviewerJson([wireFinding({ title: 'Gemini finding', filePath: 'src/parser.ts' })])),
      claude: (r) => completed('claude', r, acceptAll(r.prompt)),
      ...scripts.scripts,
    },
  });
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

  return { app, h, http: () => request(app.getHttpServer()) };
}

const body = (h: Harness) => h.request();

describe('ReviewsController', () => {
  it('creates a review and returns a valid queued ReviewJob', async () => {
    const { http, h } = await setup();

    const response = await http().post('/api/reviews').send(body(h)).expect(201);

    const job = ReviewJobSchema.parse(response.body);
    expect(job.state).toBe('queued');
    expect(JSON.stringify(response.body)).not.toMatch(/standardsStoragePath|sanitizedLog|additionalInstructions/u);
    await h.orchestrator.awaitCompletion(job.id);
  });

  it('rejects invalid bodies with 400 and field paths', async () => {
    const { http, h } = await setup();

    const duplicate = await http().post('/api/reviews').send({ ...body(h), reviewers: [body(h).reviewers[0], body(h).reviewers[0]] }).expect(400);
    expect(JSON.stringify(duplicate.body)).toContain('reviewers');
    await http().post('/api/reviews').send({ ...body(h), extra: true }).expect(400);
    await http().post('/api/reviews').send({}).expect(400);
  });

  it('answers 409 with the active review id while another review is running', async () => {
    const gate = new Gate();
    const { http, h } = await setup({
      scripts: {
        codex: async (r) => {
          await gate.opened;

          return completed('codex', r, reviewerJson());
        },
      },
    });
    const first = await http().post('/api/reviews').send(body(h)).expect(201);

    const second = await http().post('/api/reviews').send(body(h)).expect(409);

    expect(second.body).toMatchObject({ activeReviewId: first.body.id });
    gate.open();
    await h.orchestrator.awaitCompletion(first.body.id as string);
  });

  it('answers 422 when a selected provider is not ready', async () => {
    const { http, h } = await setup();
    h.providers.blocked.add('gemini/pro');

    const response = await http().post('/api/reviews').send(body(h)).expect(422);

    expect(response.body.message).toMatch(/not ready/u);
  });

  it('serves the active review, or 204 when none is active', async () => {
    const gate = new Gate();
    const { http, h } = await setup({
      scripts: {
        codex: async (r) => {
          await gate.opened;

          return completed('codex', r, reviewerJson());
        },
      },
    });
    await http().get('/api/reviews/active').expect(204);

    const created = await http().post('/api/reviews').send(body(h)).expect(201);
    const active = await http().get('/api/reviews/active').expect(200);
    expect(active.body.id).toBe(created.body.id);

    gate.open();
    await h.orchestrator.awaitCompletion(created.body.id as string);
    await http().get('/api/reviews/active').expect(204);
  });

  it('gets a review by id and 404s for unknown or malformed ids', async () => {
    const { http, h } = await setup();
    const created = await http().post('/api/reviews').send(body(h)).expect(201);
    await h.orchestrator.awaitCompletion(created.body.id as string);

    const found = await http().get(`/api/reviews/${created.body.id as string}`).expect(200);
    expect(ReviewJobSchema.parse(found.body).state).toBe('completed');
    await http().get('/api/reviews/00000000-0000-4000-8000-00000000ffff').expect(404);
    await http().get('/api/reviews/not-a-uuid').expect(404);
  });

  it('lists history with filters and validates the query', async () => {
    const { http, h } = await setup({ scripts: { codex: (r) => failed('codex', r, 'no'), gemini: (r) => failed('gemini', r, 'no') } });
    const created = await http().post('/api/reviews').send(body(h)).expect(201);
    await h.orchestrator.awaitCompletion(created.body.id as string);

    const failedPage = await http().get('/api/reviews?status=failed').expect(200);
    expect(failedPage.body.items).toHaveLength(1);
    expect(failedPage.body.items[0]).toMatchObject({ status: 'failed', overallRisk: null, findingCount: null });
    expect(failedPage.body.nextCursor).toBeNull();
    expect((await http().get('/api/reviews?status=completed').expect(200)).body.items).toHaveLength(0);
    await http().get('/api/reviews?limit=0').expect(400);
    await http().get('/api/reviews?unknown=1').expect(400);
  });

  it('cancels a running review and 404s for unknown ones', async () => {
    const gate = new Gate();
    const { http, h } = await setup({
      scripts: {
        codex: async (r) => {
          await gate.opened;

          return completed('codex', r, reviewerJson());
        },
      },
    });
    const created = await http().post('/api/reviews').send(body(h)).expect(201);

    const cancelled = await http().post(`/api/reviews/${created.body.id as string}/cancel`).expect(200);

    expect(['cancelling', 'cancelled']).toContain(cancelled.body.state);
    gate.open();
    await h.orchestrator.awaitCompletion(created.body.id as string);
    expect((await http().get(`/api/reviews/${created.body.id as string}`)).body.state).toBe('cancelled');
    await http().post('/api/reviews/00000000-0000-4000-8000-00000000ffff/cancel').expect(404);
  });

  it('streams schema-valid SSE events starting with a snapshot, and 404s for unknown reviews', async () => {
    const { http, h } = await setup();
    const created = await http().post('/api/reviews').send(body(h)).expect(201);
    await h.orchestrator.awaitCompletion(created.body.id as string);

    const response = await http().get(`/api/reviews/${created.body.id as string}/events`).buffer(true).expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    const events = response.text
      .split('\n\n')
      .map((chunk) => /^data: (.*)$/mu.exec(chunk)?.[1])
      .filter((data): data is string => data !== undefined)
      .map((data) => ReviewEventSchema.parse(JSON.parse(data)));
    expect(events[0]?.type).toBe('job.snapshot');
    await http().get('/api/reviews/00000000-0000-4000-8000-00000000ffff/events').expect(404);
  });

  it('downloads the canonical Markdown safely and 404s when no report exists', async () => {
    const { http, h } = await setup({ scripts: { claude: (r) => failed('claude', r, 'down') } });
    const bad = await http().post('/api/reviews').send(body(h)).expect(201);
    await h.orchestrator.awaitCompletion(bad.body.id as string);
    await http().get(`/api/reviews/${bad.body.id as string}/report.md`).expect(404);

    const good = await setup();
    const created = await good.http().post('/api/reviews').send(body(good.h)).expect(201);
    await good.h.orchestrator.awaitCompletion(created.body.id as string);

    const response = await good.http().get(`/api/reviews/${created.body.id as string}/report.md`).expect(200);

    expect(response.headers['content-type']).toContain('text/markdown');
    expect(response.headers['content-disposition']).toBe(`attachment; filename="review-${created.body.id as string}.md"`);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.text).toMatch(/^# Pull request review:/u);
  });
});
