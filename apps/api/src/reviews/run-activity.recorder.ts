import {
  RUN_ACTIVITY_RETAINED_PER_RUN,
  RunActivitySchema,
  type ActivityKind,
  type ActivityOutcome,
  type ActivityVisibility,
  type RunActivity,
  type RunRole,
} from '@pr-orchestrator/contracts';

import type { ProviderActivityObservation, ProviderActivitySink } from '../providers/provider-adapter.js';
import type { RunActivityPayload, RunActivityRecord } from './entities/run-activity.entity.js';
import type { ReviewEventsService } from './review-events.service.js';
import type { RunActivityStore } from './review-repository.js';
import type { RunLivenessService } from './run-liveness.service.js';

export interface ActivityRun {
  jobId: string;
  runId: string;
  role: RunRole;
}

/** Identical consecutive provider entries closer than this are recorded once. */
export const ACTIVITY_COALESCE_MS = 2_000;

interface Track {
  run: ActivityRun;
  seq: number;
  visibility: ActivityVisibility | null;
  lastActivityAt: string | null;
  lastProvider: { key: string; atMs: number } | undefined;
  /** Serializes persistence and emission so entries keep their order. */
  chain: Promise<void>;
}

/**
 * Records normalized activity for reviewer and verifier runs: assigns per-run
 * sequence numbers, persists each entry (bounded by
 * `RUN_ACTIVITY_RETAINED_PER_RUN`) and only then emits `run.activity`, so a
 * snapshot taken afterwards already contains it. Heartbeats are kept apart:
 * they update in-memory liveness and emit `run.heartbeat`, but are never
 * persisted and never move `lastActivityAt`.
 *
 * Nothing here can fail a review: storage errors drop the entry (it is not
 * emitted), and the provider-facing sink never throws.
 */
export class RunActivityRecorder {
  private readonly tracks = new Map<string, Track>();

  constructor(
    private readonly store: RunActivityStore,
    private readonly events: ReviewEventsService,
    private readonly liveness: RunLivenessService,
    private readonly clock: () => Date,
  ) {}

  /** Starts (or resumes) tracking a run; idempotent. */
  begin(run: ActivityRun, previous?: { count: number; visibility: ActivityVisibility | null; lastActivityAt: string | null }): void {
    if (this.tracks.has(run.runId)) return;
    this.tracks.set(run.runId, {
      run,
      seq: previous?.count ?? 0,
      visibility: previous?.visibility ?? null,
      lastActivityAt: previous?.lastActivityAt ?? null,
      lastProvider: undefined,
      chain: Promise.resolve(),
    });
  }

  attemptStarted(runId: string, attempt: number): void {
    this.enqueue(runId, 'lifecycle', { action: 'attempt_started', attempt });
  }

  attemptEnded(runId: string, attempt: number, outcome: ActivityOutcome): void {
    this.enqueue(runId, 'lifecycle', { action: 'attempt_ended', attempt, outcome });
  }

  /** The sink handed to the provider adapter for one attempt. */
  sink(runId: string, attempt: number): ProviderActivitySink {
    return {
      visibility: (visibility) => this.setVisibility(runId, attempt, visibility),
      activity: (observation) => this.observe(runId, attempt, observation),
      skipped: (count) => {
        if (Number.isInteger(count) && count > 0) this.enqueue(runId, 'notice', { action: 'events_skipped', attempt, count });
      },
    };
  }

  /** Process liveness only: emitted, never persisted, never counted as activity. */
  heartbeat(runId: string): void {
    const track = this.tracks.get(runId);
    if (!track) return;
    const at = this.now();
    this.liveness.beat(runId, at);
    this.events.runHeartbeat(track.run.jobId, runId, track.run.role, at);
  }

  /** Waits until every entry of the run is persisted and emitted, then stops tracking it. */
  async finish(runId: string): Promise<void> {
    const track = this.tracks.get(runId);
    this.liveness.clear(runId);
    if (!track) return;
    await track.chain;
    this.tracks.delete(runId);
  }

  trackedRunCount(): number {
    return this.tracks.size;
  }

  private setVisibility(runId: string, attempt: number, visibility: ActivityVisibility): void {
    const track = this.tracks.get(runId);
    if (!track) return;
    track.chain = track.chain.then(async () => {
      try {
        await this.store.setRunActivityVisibility(track.run.jobId, runId, visibility);
        track.visibility = visibility;
      } catch {
        // The entry below still records the process start.
      }
    });
    this.enqueue(runId, 'lifecycle', { action: 'process_started', attempt });
  }

  private observe(runId: string, attempt: number, observation: ProviderActivityObservation): void {
    const track = this.tracks.get(runId);
    if (!track) return;

    const target = observation.target;
    const key = [observation.action, observation.tool, target?.path, target?.startLine, target?.endLine].join('|');
    const nowMs = this.clock().getTime();
    if (track.lastProvider?.key === key && nowMs - track.lastProvider.atMs < ACTIVITY_COALESCE_MS) return;
    track.lastProvider = { key, atMs: nowMs };

    this.enqueue(runId, 'provider', {
      action: observation.action,
      attempt,
      ...(observation.tool === undefined ? {} : { tool: observation.tool }),
      ...(target === undefined ? {} : { target: { ...target } }),
    });
  }

  private enqueue(runId: string, kind: ActivityKind, payload: RunActivityPayload): void {
    const track = this.tracks.get(runId);
    if (!track) return;
    const at = this.now();

    track.chain = track.chain.then(async () => {
      const entry = validEntry(runId, track.seq + 1, at, kind, payload);
      if (!entry) return;
      track.seq = entry.seq;

      const { id: _id, runId: _runId, seq, at: entryAt, kind: entryKind, ...rest } = entry;
      const record: RunActivityRecord = { jobId: track.run.jobId, runId, seq, at: entryAt, kind: entryKind, payload: rest };
      try {
        await this.store.appendRunActivity(record, RUN_ACTIVITY_RETAINED_PER_RUN);
      } catch {
        // Not persisted, so not announced: a later snapshot must never miss an emitted entry.
        return;
      }
      if (kind === 'provider' && (track.lastActivityAt === null || at > track.lastActivityAt)) track.lastActivityAt = at;

      this.events.runActivity(track.run.jobId, {
        runId,
        role: track.run.role,
        activity: entry,
        visibility: track.visibility,
        total: track.seq,
        lastActivityAt: track.lastActivityAt,
      });
    });
  }

  private now(): string {
    return this.clock().toISOString();
  }
}

/**
 * Validates the entry against the shared contract before it is stored. An
 * invalid target is dropped rather than losing the whole entry.
 */
function validEntry(
  runId: string,
  seq: number,
  at: string,
  kind: ActivityKind,
  payload: RunActivityPayload,
): RunActivity | undefined {
  const entry = { id: `${runId}:${seq}`, runId, seq, at, kind, ...payload };
  const parsed = RunActivitySchema.safeParse(entry);
  if (parsed.success) return parsed.data;
  if (payload.target === undefined) return undefined;

  const { target: _dropped, ...withoutTarget } = entry;
  const retried = RunActivitySchema.safeParse(withoutTarget);

  return retried.success ? retried.data : undefined;
}
