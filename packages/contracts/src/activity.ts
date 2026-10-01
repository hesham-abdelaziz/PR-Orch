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
