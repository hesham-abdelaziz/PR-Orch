import { z } from 'zod';
import { ActivityVisibilitySchema, RunActivitySchema, RunActivitySummarySchema, RunRoleSchema } from './activity.js';

import { PullRequestSummarySchema } from './pull-requests.js';
import { ModelSelectionSchema } from './providers.js';
import { StandardsMetadataSchema } from './settings.js';

export const JobStateSchema = z.enum([
  'queued',
  'preparing',
  'reviewing',
  'verifying',
  'rendering',
  'completed',
  'failed',
  'cancelling',
  'cancelled',
]);

export const RunStateSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'timed_out',
  'cancelled',
]);

export const CreateReviewRequestSchema = z
  .strictObject({
    pullRequestUrl: z.string().url(),
    main: ModelSelectionSchema,
    reviewers: z.array(ModelSelectionSchema).min(1).max(8),
    additionalInstructions: z.string().max(10_000).optional(),
  })
  .superRefine((request, context) => {
    const seen = new Set<string>();

    request.reviewers.forEach((reviewer, index) => {
      const key = `${reviewer.provider}\u0000${reviewer.model}`;

      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['reviewers', index],
          message: 'Duplicate provider/model reviewer selection',
        });
      }

      seen.add(key);
    });
  });

export const ReviewerRunSchema = z.strictObject({
  id: z.string().uuid(),
  selection: ModelSelectionSchema,
  state: RunStateSchema,
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  warning: z.string().trim().min(1).max(1_000).nullable(),
  activity: RunActivitySummarySchema.optional(),
});

export const ReviewJobSchema = z.strictObject({
  id: z.string().uuid(),
  state: JobStateSchema,
  pullRequest: PullRequestSummarySchema,
  main: ModelSelectionSchema,
  reviewers: z.array(ReviewerRunSchema).min(1).max(8),
  verifier: ReviewerRunSchema.optional(),
  standards: StandardsMetadataSchema.nullable(),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

const ReviewEventBaseShape = {
  reviewId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  emittedAt: z.string().datetime(),
};

export const ReviewEventSchema = z.discriminatedUnion('type', [
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
  z.strictObject({
    ...ReviewEventBaseShape,
    type: z.literal('job.snapshot'),
    payload: z.strictObject({ job: ReviewJobSchema }),
  }),
  z.strictObject({
    ...ReviewEventBaseShape,
    type: z.literal('job.state_changed'),
    payload: z.strictObject({ state: JobStateSchema }),
  }),
  z.strictObject({
    ...ReviewEventBaseShape,
    type: z.literal('reviewer.state_changed'),
    payload: z.strictObject({
      runId: z.string().uuid(),
      state: RunStateSchema,
      reviewer: ModelSelectionSchema,
      role: RunRoleSchema.optional(),
      startedAt: z.string().datetime().nullable().optional(),
      completedAt: z.string().datetime().nullable().optional(),
    }),
  }),
  z.strictObject({
    ...ReviewEventBaseShape,
    type: z.literal('job.warning'),
    payload: z.strictObject({
      code: z.string().trim().min(1).max(100),
      message: z.string().trim().min(1).max(1_000),
    }),
  }),
]);

export type JobState = z.infer<typeof JobStateSchema>;
export type RunState = z.infer<typeof RunStateSchema>;
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;
export type ReviewJob = z.infer<typeof ReviewJobSchema>;
export type ReviewEvent = z.infer<typeof ReviewEventSchema>;
