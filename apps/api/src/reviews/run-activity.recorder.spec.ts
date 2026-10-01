import type { ActivityVisibility } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import type { RunActivityRecord } from './entities/run-activity.entity.js';
import type { ReviewEventsService } from './review-events.service.js';
import type { RunActivityStore } from './review-repository.js';
import { ACTIVITY_COALESCE_MS, RunActivityRecorder } from './run-activity.recorder.js';
import { RunLivenessService } from './run-liveness.service.js';

const JOB = '00000000-0000-4000-8000-00000000000a';
const RUN = '00000000-0000-4000-8000-00000000000b';

function setup(options: { failAppend?: boolean } = {}) {
  let nowMs = Date.parse('2026-10-01T00:00:00.000Z');
  const rows: RunActivityRecord[] = [];
  const visibility: ActivityVisibility[] = [];
  const emitted: { type: string; payload: Record<string, unknown> }[] = [];
  const store: RunActivityStore = {
    appendRunActivity: (record) => {
      if (options.failAppend) return Promise.reject(new Error('disk full'));
      rows.push(record);

      return Promise.resolve();
    },
    setRunActivityVisibility: (_job, _run, value) => {
      visibility.push(value);

      return Promise.resolve();
    },
    listRunActivity: () => Promise.resolve([]),
    listRunActivityForRun: () => Promise.resolve([]),
  };
  const events = {
    runActivity: (_reviewId: string, payload: Record<string, unknown>) => {
      // Emission must follow persistence of the same entry.
      const activity = payload['activity'] as { seq: number };
      expect(rows.some((row) => row.seq === activity.seq)).toBe(true);
      emitted.push({ type: 'run.activity', payload });
    },
    runHeartbeat: (_reviewId: string, runId: string, role: string, at: string) =>
      emitted.push({ type: 'run.heartbeat', payload: { runId, role, at } }),
  } as unknown as ReviewEventsService;
  const liveness = new RunLivenessService();
  const recorder = new RunActivityRecorder(store, events, liveness, () => new Date(nowMs));
  recorder.begin({ jobId: JOB, runId: RUN, role: 'verifier' });

  return {
    recorder,
    rows,
    visibility,
    emitted,
    liveness,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('RunActivityRecorder', () => {
  it('numbers, persists and then emits entries in order, with visibility on later events', async () => {
    const { recorder, rows, visibility, emitted, advance } = setup();
    const sink = recorder.sink(RUN, 1);

    recorder.attemptStarted(RUN, 1);
    sink.visibility('full');
    advance(10);
    sink.activity({ action: 'reading_file', tool: 'Read', target: { path: 'src/a.ts', startLine: 2, endLine: 4 } });
    sink.skipped(3);
    recorder.attemptEnded(RUN, 1, 'completed');
    await recorder.finish(RUN);

    expect(rows.map((row) => [row.seq, row.kind, row.payload.action])).toEqual([
      [1, 'lifecycle', 'attempt_started'],
      [2, 'lifecycle', 'process_started'],
      [3, 'provider', 'reading_file'],
      [4, 'notice', 'events_skipped'],
      [5, 'lifecycle', 'attempt_ended'],
    ]);
    expect(visibility).toEqual(['full']);
    const last = emitted.at(-1)?.payload;
    expect(last).toMatchObject({ runId: RUN, role: 'verifier', visibility: 'full', total: 5 });
    expect(last?.['lastActivityAt']).toBe(rows[2]?.at);
    expect(last?.['activity']).toMatchObject({ id: `${RUN}:5` });
    expect(recorder.trackedRunCount()).toBe(0);
  });

  it('keeps heartbeats out of storage and out of lastActivityAt', async () => {
    const { recorder, rows, emitted, liveness, advance } = setup();
    const sink = recorder.sink(RUN, 1);

    sink.activity({ action: 'thinking' });
    await new Promise((resolve) => setImmediate(resolve));
    advance(30_000);
    recorder.heartbeat(RUN);
    expect(liveness.lastHeartbeat(RUN)).toBe('2026-10-01T00:00:30.000Z');
    recorder.attemptEnded(RUN, 1, 'completed');
    await recorder.finish(RUN);

    expect(rows.map((row) => row.payload.action)).toEqual(['thinking', 'attempt_ended']);
    expect(emitted.filter((event) => event.type === 'run.heartbeat')).toHaveLength(1);
    expect(emitted.at(-1)?.payload['lastActivityAt']).toBe('2026-10-01T00:00:00.000Z');
    expect(liveness.lastHeartbeat(RUN)).toBeNull();
  });

  it('coalesces identical consecutive observations within the window only', async () => {
    const { recorder, rows, advance } = setup();
    const sink = recorder.sink(RUN, 1);

    sink.activity({ action: 'thinking' });
    advance(ACTIVITY_COALESCE_MS - 1);
    sink.activity({ action: 'thinking' });
    sink.activity({ action: 'searching', tool: 'Grep' });
    sink.activity({ action: 'thinking' });
    advance(ACTIVITY_COALESCE_MS);
    sink.activity({ action: 'thinking' });
    await recorder.finish(RUN);

    expect(rows.map((row) => row.payload.action)).toEqual(['thinking', 'searching', 'thinking', 'thinking']);
  });

  it('drops an invalid target but keeps the entry, and refuses unknown actions entirely', async () => {
    const { recorder, rows } = setup();
    const sink = recorder.sink(RUN, 1);

    sink.activity({ action: 'reading_file', target: { path: '../etc/passwd' } });
    sink.activity({ action: 'reading_file', target: { path: 'C:/abs.ts' } });
    sink.activity({ action: 'not_an_action' as never });
    await recorder.finish(RUN);

    expect(rows.map((row) => row.payload)).toEqual([
      { action: 'reading_file', attempt: 1 },
      { action: 'reading_file', attempt: 1 },
    ]);
  });

  it('never emits an entry it could not store, and never throws into the provider', async () => {
    const { recorder, emitted } = setup({ failAppend: true });
    const sink = recorder.sink(RUN, 1);

    expect(() => sink.activity({ action: 'thinking' })).not.toThrow();
    recorder.attemptEnded(RUN, 1, 'failed');
    await recorder.finish(RUN);

    expect(emitted).toEqual([]);
  });

  it('ignores activity for runs it does not track', async () => {
    const { recorder, rows } = setup();
    await recorder.finish(RUN);

    recorder.sink(RUN, 1).activity({ action: 'thinking' });
    recorder.heartbeat(RUN);
    await recorder.finish(RUN);

    expect(rows).toEqual([]);
  });
});
