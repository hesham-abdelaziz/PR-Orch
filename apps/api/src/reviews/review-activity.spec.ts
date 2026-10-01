import { ReviewJobSchema, type ReviewJob, type RunActivity } from '@pr-orchestrator/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CLAUDE,
  CODEX,
  Gate,
  acceptAll,
  completed,
  createHarness,
  failed,
  hangUntilAborted,
  reviewerJson,
  wireFinding,
  type Harness,
  type HarnessOptions,
  type Script,
} from '../../../../tests/fixtures/fake-clis/orchestrator-harness.js';
import { jobRecord } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { waitFor } from '../../../../tests/fixtures/fake-clis/scenarios.js';
import { ReportQueryService } from '../reports/report-query.service.js';
import type { ReviewerRunRecord } from './entities/reviewer-run.entity.js';
import { toReviewJob } from './review-job.mapper.js';

const harnesses: Harness[] = [];
async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const created = await createHarness(options);
  harnesses.push(created);

  return created;
}
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((created) => created.dispose()));
});

const codexReviewer: Script = (request) => {
  request.activity?.visibility('partial');
  request.activity?.activity({ action: 'running_command', tool: 'shell' });

  return completed('codex', request, reviewerJson([wireFinding({ title: 'Unchecked null dereference in loader' })]));
};
const geminiReviewer: Script = (request) => {
  request.activity?.visibility('full');
  request.activity?.activity({ action: 'reading_file', tool: 'read_file', target: { path: 'src/loader.ts', startLine: 1, endLine: 40 } });

  return completed('gemini', request, reviewerJson([]));
};
const claudeVerifier: Script = (request) => {
  request.activity?.visibility('full');
  request.activity?.activity({ action: 'reading_file', tool: 'Read', target: { path: 'src/loader.ts', startLine: 10, endLine: 20 } });
  request.activity?.skipped(2);

  return completed('claude', request, acceptAll(request.prompt));
};

/** Records activity/heartbeat/state events in emission order. */
function recordEvents(h: Harness): { type: string; runId: string; detail: string; id?: string }[] {
  const seen: { type: string; runId: string; detail: string; id?: string }[] = [];
  const runActivity = h.events.runActivity.bind(h.events);
  h.events.runActivity = (reviewId, payload) => {
    seen.push({ type: 'activity', runId: payload.runId, detail: payload.activity.action, id: payload.activity.id });
    runActivity(reviewId, payload);
  };
  const runHeartbeat = h.events.runHeartbeat.bind(h.events);
  h.events.runHeartbeat = (reviewId, runId, role, at) => {
    seen.push({ type: 'heartbeat', runId, detail: role });
    runHeartbeat(reviewId, runId, role, at);
  };
  const stateChanged = h.events.reviewerStateChanged.bind(h.events);
  h.events.reviewerStateChanged = (reviewId, runId, state, reviewer, details) => {
    seen.push({ type: 'state', runId, detail: state });
    stateChanged(reviewId, runId, state, reviewer, details);
  };

  return seen;
}

const actions = (entries: readonly RunActivity[]) => entries.map((entry) => entry.action);

async function until(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('run activity across a review', () => {
  it('records reviewer and verifier activity and restores it from storage after completion', async () => {
    const h = await harness({ scripts: { codex: codexReviewer, gemini: geminiReviewer, claude: claudeVerifier } });
    const seen = recordEvents(h);

    const created = await h.orchestrator.createReview(h.request());
    await h.orchestrator.awaitCompletion(created.id);
    await h.events.flush(created.id);
    const job = (await new ReportQueryService(h.repository, h.liveness).getReview(created.id)) as ReviewJob;

    expect(job.state).toBe('completed');
    expect(() => ReviewJobSchema.parse(job)).not.toThrow();

    const verifier = job.verifier?.activity;
    expect(verifier?.visibility).toBe('full');
    expect(actions(verifier?.recent ?? [])).toEqual([
      'attempt_started',
      'process_started',
      'reading_file',
      'events_skipped',
      'attempt_ended',
    ]);
    expect(verifier?.current).toMatchObject({
      action: 'reading_file',
      tool: 'Read',
      target: { path: 'src/loader.ts', startLine: 10, endLine: 20 },
    });
    expect(verifier?.lastActivityAt).toBe(verifier?.current?.at);
    expect(verifier?.recent.find((entry) => entry.action === 'events_skipped')?.count).toBe(2);
    expect(verifier?.recent.at(-1)).toMatchObject({ action: 'attempt_ended', outcome: 'completed', attempt: 1 });
    expect(verifier?.lastHeartbeatAt).toBeNull();
    expect(verifier?.total).toBe(5);

    const [codex, gemini] = job.reviewers;
    expect(codex?.activity).toMatchObject({ visibility: 'partial', current: { action: 'running_command', tool: 'shell' } });
    expect(gemini?.activity?.current?.target).toEqual({ path: 'src/loader.ts', startLine: 1, endLine: 40 });

    // Every live entry is in the restored snapshot under the same id, and ids never repeat.
    const liveIds = seen.filter((event) => event.type === 'activity').map((event) => event.id);
    const storedIds = [job.verifier, ...job.reviewers].flatMap((run) => run?.activity?.recent.map((entry) => entry.id) ?? []);
    expect(new Set(liveIds).size).toBe(liveIds.length);
    const byText = (left?: string, right?: string) => (left ?? '').localeCompare(right ?? '');
    expect([...liveIds].sort(byText)).toEqual([...storedIds].sort(byText));

    // A run's activity is announced before its final state, and the verifier now has state events.
    const verifierId = job.verifier?.id ?? '';
    const verifierEvents = seen.filter((event) => event.runId === verifierId);
    expect(verifierEvents.at(0)).toMatchObject({ type: 'state', detail: 'running' });
    expect(verifierEvents.at(-1)).toMatchObject({ type: 'state', detail: 'completed' });
  });

  it('emits heartbeats while a provider is quiet without moving lastActivityAt or storing them', async () => {
    const gate = new Gate();
    const h = await harness({
      heartbeatIntervalMs: 5,
      scripts: {
        codex: async (request) => {
          request.activity?.visibility('partial');
          request.activity?.activity({ action: 'thinking' });
          await gate.opened;

          return completed('codex', request, reviewerJson([]));
        },
        gemini: geminiReviewer,
        claude: claudeVerifier,
      },
    });
    const seen = recordEvents(h);
    const query = new ReportQueryService(h.repository, h.liveness);

    const created = await h.orchestrator.createReview(h.request());
    const codexRunId = created.reviewers[0]?.id ?? '';
    await waitFor(() => seen.filter((event) => event.type === 'heartbeat' && event.runId === codexRunId).length >= 2, 5_000);

    const live = await query.getReview(created.id);
    const quiet = live?.reviewers[0]?.activity;
    expect(quiet?.lastHeartbeatAt).not.toBeNull();
    expect(quiet?.current?.action).toBe('thinking');
    expect(quiet?.lastActivityAt).toBe(quiet?.current?.at);
    expect(Date.parse(quiet?.lastHeartbeatAt ?? '')).toBeGreaterThan(Date.parse(quiet?.lastActivityAt ?? ''));
    expect(actions(quiet?.recent ?? [])).not.toContain('heartbeat');

    gate.open();
    await h.orchestrator.awaitCompletion(created.id);
    const done = await query.getReview(created.id);
    expect(done?.reviewers[0]?.activity?.lastHeartbeatAt).toBeNull();
    expect(done?.reviewers[0]?.activity?.lastActivityAt).toBe(quiet?.lastActivityAt);
    expect(h.liveness.trackedRunCount()).toBe(0);
  });

  it('records the end of cancelled, failed and invalid attempts', async () => {
    const started = new Gate();
    const h = await harness({
      scripts: {
        codex: (request) => {
          request.activity?.visibility('heartbeat_only');
          started.open();

          return hangUntilAborted('codex', request);
        },
        gemini: (request, call) =>
          call === 0
            ? completed('gemini', request, 'not json at all')
            : failed('gemini', request, 'boom'),
      },
    });

    const created = await h.orchestrator.createReview(h.request());
    await started.opened;
    await until(async () => {
      const runs = await h.repository.listRuns(created.id);
      return runs.find((run) => run.selection.provider === 'gemini')?.state === 'failed';
    });
    await h.orchestrator.cancelReview(created.id);
    await h.orchestrator.awaitCompletion(created.id);
    const job = await new ReportQueryService(h.repository, h.liveness).getReview(created.id);

    const [codex, gemini] = job?.reviewers ?? [];
    expect(codex?.state).toBe('cancelled');
    expect(codex?.activity?.visibility).toBe('heartbeat_only');
    expect(codex?.activity?.current).toBeNull();
    expect(codex?.activity?.recent.at(-1)).toMatchObject({ action: 'attempt_ended', outcome: 'cancelled' });
    expect(gemini?.activity?.recent.filter((entry) => entry.action === 'attempt_ended')).toEqual([
      expect.objectContaining({ attempt: 1, outcome: 'invalid_output' }),
      expect.objectContaining({ attempt: 2, outcome: 'failed' }),
    ]);
    expect(job?.verifier?.state).toBe('cancelled');
    expect(job?.verifier?.activity?.recent).toEqual([]);
  });

  it('completes the review when activity storage fails, announcing nothing it did not store', async () => {
    const h = await harness({ scripts: { codex: codexReviewer, gemini: geminiReviewer, claude: claudeVerifier } });
    h.repository.appendRunActivity = () => Promise.reject(new Error('disk full'));
    const seen = recordEvents(h);

    const created = await h.orchestrator.createReview(h.request());
    await h.orchestrator.awaitCompletion(created.id);

    expect((await h.repository.getJob(created.id))?.state).toBe('completed');
    expect(seen.filter((event) => event.type === 'activity')).toEqual([]);
  });
});

describe('snapshots of reviews recorded before activity existed', () => {
  const legacyRun = (role: 'reviewer' | 'verifier', id: string): ReviewerRunRecord => ({
    id,
    jobId: '00000000-0000-4000-8000-000000000001',
    role,
    selection: role === 'verifier' ? CLAUDE : CODEX,
    state: 'completed',
    startedAt: '2026-09-01T10:00:00.000Z',
    completedAt: '2026-09-01T10:05:00.000Z',
    warning: null,
    attempts: 1,
    sanitizedLog: '',
    result: null,
  });

  it('renders empty activity summaries with unknown visibility and still validates', () => {
    const record = jobRecord({ id: '00000000-0000-4000-8000-000000000001', state: 'completed', reviewers: [CODEX] });
    const runs = [
      legacyRun('reviewer', '00000000-0000-4000-8000-000000000002'),
      legacyRun('verifier', '00000000-0000-4000-8000-000000000003'),
    ];

    const job = toReviewJob(record, runs, { entries: [], lastHeartbeat: () => '2026-09-01T10:01:00.000Z' });

    expect(() => ReviewJobSchema.parse(job)).not.toThrow();
    expect(job.reviewers[0]?.activity).toEqual({
      visibility: null,
      recent: [],
      current: null,
      lastActivityAt: null,
      lastHeartbeatAt: null,
      total: 0,
    });
    expect(job.verifier?.id).toBe('00000000-0000-4000-8000-000000000003');
    // History rows omit activity entirely.
    expect(toReviewJob(record, runs).reviewers[0]).not.toHaveProperty('activity');
  });

  it('skips stored rows that no longer validate instead of failing the snapshot', () => {
    const record = jobRecord({ id: '00000000-0000-4000-8000-000000000001', state: 'completed', reviewers: [CODEX] });
    const run = legacyRun('reviewer', '00000000-0000-4000-8000-000000000002');
    const job = toReviewJob(record, [run], {
      entries: [
        { jobId: run.jobId, runId: run.id, seq: 1, at: '2026-09-01T10:00:01.000Z', kind: 'provider', payload: { action: 'thinking' } },
        { jobId: run.jobId, runId: run.id, seq: 2, at: 'yesterday', kind: 'provider', payload: { action: 'thinking' } },
      ],
      lastHeartbeat: () => null,
    });

    expect(job.reviewers[0]?.activity?.recent.map((entry) => entry.seq)).toEqual([1]);
    expect(job.reviewers[0]?.activity?.total).toBe(2);
  });
});
