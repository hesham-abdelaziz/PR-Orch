# Codex handoff — V1 live run activity: shared contracts + persistence

Repository: `C:\Users\EGDev06\PR-Orch`, branch `feat/live-run-activity` (from `main` @ `e249d57`).
Feature: live, bounded, sanitized activity for each reviewer and the main verifier
(current action, repo-relative file/lines, heartbeat separate from real activity),
streamed over the existing SSE and restored after refresh.

## Ownership on this branch

| Owner | Files |
| --- | --- |
| **Codex (you)** | `packages/contracts/**`, `apps/api/src/database/**` (migration, data source, SQLite repository + specs) |
| Claude | `apps/api/src/providers/**`, `apps/api/src/reviews/**`, `apps/api/src/reports/**`, `tests/fixtures/fake-clis/**` |
| Gemini | `apps/web/**` |

Do not edit files outside your area. Claude has already added the persistence
port you implement:

- `apps/api/src/reviews/entities/run-activity.entity.ts` (`RunActivityRecord`, `RunActivityPayload`, `RunActivityState`)
- `apps/api/src/reviews/entities/reviewer-run.entity.ts` (new optional read-only `activity?: RunActivityState`)
- `apps/api/src/reviews/review-repository.ts` (new `RunActivityStore`, which `ReviewRepository` now extends)

Order: **contracts first** (Claude and Gemini code against them), then the database.

---

## Part 1: contracts (`packages/contracts`)

### New file `src/activity.ts` (export from `src/index.ts`)

```ts
import { z } from 'zod';
import { NormalizedRelativePathSchema } from './findings.js';

/** Entries kept per run in storage; older ones are pruned. */
export const RUN_ACTIVITY_RETAINED_PER_RUN = 200;
/** Entries per run included in a job snapshot. */
export const RUN_ACTIVITY_SNAPSHOT_PER_RUN = 50;

export const RunRoleSchema = z.enum(['reviewer', 'verifier']);

/** What the provider's CLI lets us observe for a run. */
export const ActivityVisibilitySchema = z.enum([
  'full',           // structured tool events incl. file paths (Claude, Gemini)
  'partial',        // tool/command kinds without paths or arguments (Codex)
  'heartbeat_only', // no structured stream; liveness only
]);

export const ActivityKindSchema = z.enum(['provider', 'lifecycle', 'notice']);

export const PROVIDER_ACTIVITY_ACTIONS = [
  'reading_file', 'searching', 'listing_files', 'running_command',
  'thinking', 'writing_answer', 'tool_other',
] as const;
export const LIFECYCLE_ACTIVITY_ACTIONS = ['attempt_started', 'process_started', 'attempt_ended'] as const;
export const NOTICE_ACTIVITY_ACTIONS = ['events_skipped'] as const;

export const ActivityActionSchema = z.enum([
  ...PROVIDER_ACTIVITY_ACTIONS, ...LIFECYCLE_ACTIVITY_ACTIONS, ...NOTICE_ACTIVITY_ACTIONS,
]);

export const ActivityOutcomeSchema = z.enum(['completed', 'invalid_output', 'failed', 'timed_out', 'cancelled']);

/** Allowlisted provider tool identifier, e.g. `Read`, `read_file`, `shell`. */
export const ActivityToolSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u);

const LineSchema = z.number().int().min(1).max(10_000_000);

export const ActivityTargetSchema = z
  .strictObject({
    path: NormalizedRelativePathSchema,
    startLine: LineSchema.optional(),
    endLine: LineSchema.optional(),
  })
  .refine((t) => t.endLine === undefined || (t.startLine !== undefined && t.endLine >= t.startLine), {
    message: 'endLine requires startLine and must be >= startLine',
  });

export const RunActivitySchema = z
  .strictObject({
    /** `${runId}:${seq}`; stable across snapshot and live event, used for de-duplication. */
    id: z.string().min(1).max(80),
    runId: z.string().uuid(),
    seq: z.number().int().positive(),
    at: z.string().datetime(),
    kind: ActivityKindSchema,
    action: ActivityActionSchema,
    /** 1 = first provider invocation, 2 = the single correction attempt. */
    attempt: z.number().int().min(1).max(10).optional(),
    tool: ActivityToolSchema.optional(),
    target: ActivityTargetSchema.optional(),
    /** Only on `attempt_ended`. */
    outcome: ActivityOutcomeSchema.optional(),
    /** Only on `events_skipped`: number of malformed/oversized stream lines ignored. */
    count: z.number().int().nonnegative().optional(),
  })
  .superRefine((entry, ctx) => {
    const groups: Record<string, readonly string[]> = {
      provider: PROVIDER_ACTIVITY_ACTIONS,
      lifecycle: LIFECYCLE_ACTIVITY_ACTIONS,
      notice: NOTICE_ACTIVITY_ACTIONS,
    };
    if (!groups[entry.kind]!.includes(entry.action)) {
      ctx.addIssue({ code: 'custom', path: ['action'], message: `action ${entry.action} is not a ${entry.kind} action` });
    }
    if (entry.id !== `${entry.runId}:${entry.seq}`) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: 'id must be `${runId}:${seq}`' });
    }
  });

export const RunActivitySummarySchema = z.strictObject({
  /** null until the run's provider process starts, and for reviews recorded before this feature. */
  visibility: ActivityVisibilitySchema.nullable(),
  /** Newest entries, oldest first; at most RUN_ACTIVITY_SNAPSHOT_PER_RUN. */
  recent: z.array(RunActivitySchema).max(RUN_ACTIVITY_SNAPSHOT_PER_RUN),
  /** Newest `provider`-kind entry, or null. */
  current: RunActivitySchema.nullable(),
  /** Time of the newest provider-kind entry. Heartbeats, lifecycle and notices never move it. */
  lastActivityAt: z.string().datetime().nullable(),
  /** Last process heartbeat while the run is live; null otherwise (not persisted). */
  lastHeartbeatAt: z.string().datetime().nullable(),
  /** Entries ever recorded for the run (> recent.length when older entries are omitted or pruned). */
  total: z.number().int().nonnegative(),
});

/** Response of `GET /api/reviews/:reviewId/runs/:runId/activity`. */
export const RunActivityLogSchema = z.strictObject({
  runId: z.string().uuid(),
  /** Oldest first; at most RUN_ACTIVITY_RETAINED_PER_RUN. */
  items: z.array(RunActivitySchema).max(RUN_ACTIVITY_RETAINED_PER_RUN),
  total: z.number().int().nonnegative(),
});

export type RunRole = z.infer<typeof RunRoleSchema>;
export type ActivityVisibility = z.infer<typeof ActivityVisibilitySchema>;
export type ActivityKind = z.infer<typeof ActivityKindSchema>;
export type ActivityAction = z.infer<typeof ActivityActionSchema>;
export type ProviderActivityAction = (typeof PROVIDER_ACTIVITY_ACTIONS)[number];
export type ActivityOutcome = z.infer<typeof ActivityOutcomeSchema>;
export type ActivityTarget = z.infer<typeof ActivityTargetSchema>;
export type RunActivity = z.infer<typeof RunActivitySchema>;
export type RunActivitySummary = z.infer<typeof RunActivitySummarySchema>;
export type RunActivityLog = z.infer<typeof RunActivityLogSchema>;
```

### Changes to `src/reviews.ts` (additive only; old payloads must still parse)

1. `ReviewerRunSchema`: add `activity: RunActivitySummarySchema.optional()`.
2. `ReviewJobSchema`: add `verifier: ReviewerRunSchema.optional()` (the main verifier run, same shape as a reviewer run).
3. `reviewer.state_changed` payload: add `role: RunRoleSchema.optional()`, `startedAt: z.string().datetime().nullable().optional()`, `completedAt: z.string().datetime().nullable().optional()`. The event is now also emitted for the verifier (`role: 'verifier'`).
4. New `ReviewEventSchema` members (same base shape as the others):

```ts
z.strictObject({
  ...ReviewEventBaseShape,
  type: z.literal('run.activity'),
  payload: z.strictObject({
    runId: z.string().uuid(),
    role: RunRoleSchema,
    activity: RunActivitySchema,
    visibility: ActivityVisibilitySchema.nullable(),
    total: z.number().int().nonnegative(),
    lastActivityAt: z.string().datetime().nullable(),
  }),
}),
z.strictObject({
  ...ReviewEventBaseShape,
  type: z.literal('run.heartbeat'),
  payload: z.strictObject({
    runId: z.string().uuid(),
    role: RunRoleSchema,
    at: z.string().datetime(),
  }),
}),
```

### Contract tests (`src/contracts.spec.ts`)

- An old `ReviewJob` without `verifier` or `activity`, and an old `reviewer.state_changed` without the new fields, still parse.
- `RunActivitySchema` rejects: wrong kind/action pairing, `id` not equal to `${runId}:${seq}`, absolute/traversal/backslash `target.path`, `endLine < startLine`, `endLine` without `startLine`, unknown keys (e.g. `prompt`, `command`, `output`), and a tool name with spaces or shell characters.
- `run.activity` and `run.heartbeat` events round-trip; `recent` longer than 50 is rejected.

---

## Part 2: persistence (`apps/api/src/database`)

### Migration `migrations/005-run-activity.ts` (class `RunActivity1780000000005`, forward-only like 003/004; register in `data-source.ts`)

```sql
ALTER TABLE reviewer_runs ADD COLUMN activity_visibility TEXT
  CHECK(activity_visibility IS NULL OR activity_visibility IN ('full','partial','heartbeat_only'));
ALTER TABLE reviewer_runs ADD COLUMN activity_count INTEGER NOT NULL DEFAULT 0 CHECK(activity_count >= 0);
ALTER TABLE reviewer_runs ADD COLUMN last_activity_at TEXT;
CREATE TABLE run_activity (
  job_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq > 0),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('provider','lifecycle','notice')),
  payload JSON NOT NULL CHECK(length(payload) <= 2048),
  PRIMARY KEY(run_id, seq),
  FOREIGN KEY(job_id, run_id) REFERENCES reviewer_runs(job_id, id)
);
CREATE INDEX ix_run_activity_job ON run_activity(job_id, run_id, seq);
```

Existing rows get `activity_visibility NULL`, `activity_count 0` and `last_activity_at NULL`, which is how older reviews appear to the engine.

### `SqliteReviewRepository`: implement `RunActivityStore` exactly as documented in `review-repository.ts`

- `appendRunActivity(record, retain)`: one `.immediate()` transaction:
  - `INSERT` the row, with `payload = JSON.stringify(record.payload)`. A PK conflict throws.
  - `UPDATE reviewer_runs SET activity_count = MAX(activity_count, ?)`. When `kind = 'provider'`, also set `last_activity_at = CASE WHEN last_activity_at IS NULL OR last_activity_at < ? THEN ? ELSE last_activity_at END`, with `WHERE job_id=? AND id=?`. If 0 rows change, throw (unknown run).
  - `DELETE FROM run_activity WHERE run_id=? AND seq <= ?` with `record.seq - retain`.
- `setRunActivityVisibility(jobId, runId, visibility)`: `UPDATE reviewer_runs SET activity_visibility=? WHERE job_id=? AND id=?`.
- `listRunActivity(jobId, perRunLimit)`: newest `perRunLimit` per run, using `ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY seq DESC)`. Return them ordered by `run_id, seq ASC` and decode `payload`.
- `listRunActivityForRun(jobId, runId, limit)`: newest `limit` of one run, returned `seq ASC`.
- `listRuns`: also map the new columns into `activity: { visibility, count, lastActivityAt }`.
- `putRun`/`saveRun` must **not** write or reset the three new columns. The current `ON CONFLICT ... DO UPDATE SET` list already excludes them; keep it that way. A fresh insert uses the column defaults.

### Tests (`database/*.spec.ts`)

- Migration from a 004-level database with existing runs: the new columns default as above, and existing data is unchanged.
- Append + prune: after 205 appends with `retain = 200`, rows 1–5 are gone, `activity_count = 205`, and `last_activity_at` equals the newest **provider** row's `at`. A later `lifecycle`/`notice` append does not move it.
- Duplicate `(run_id, seq)` throws and changes nothing (transaction rollback).
- Append for an unknown run or a run of a different job throws.
- `saveRun` after appends leaves `activity_*` untouched.
- `listRunActivity` returns at most N per run in the right order. `listRunActivityForRun` returns an empty list for an unknown run.
- Payload over 2 KiB is rejected by the CHECK.

## Validation

```
npm run test:contracts
npm --workspace @pr-orchestrator/api test -- database
npm --workspace @pr-orchestrator/contracts run build
```

The full API build only passes once Claude's engine work lands: the in-memory repository has to implement the port. Report that rather than editing `reviews/`. Do not start the app, run paid reviews, commit, or push unless the user asks.
