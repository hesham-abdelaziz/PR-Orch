import { z } from 'zod';

import { ModelSelectionSchema } from './providers.js';

export const ReviewLimitsSchema = z
  .strictObject({
    warningChangedFiles: z.number().int().positive(),
    hardChangedFiles: z.number().int().positive(),
    warningDiffBytes: z.number().int().positive(),
    hardDiffBytes: z.number().int().positive(),
    hardInspectableFileBytes: z.number().int().positive(),
  })
  .superRefine((limits, context) => {
    if (limits.warningChangedFiles >= limits.hardChangedFiles) {
      context.addIssue({
        code: 'custom',
        path: ['warningChangedFiles'],
        message: 'warningChangedFiles must be below hardChangedFiles',
      });
    }

    if (limits.warningDiffBytes >= limits.hardDiffBytes) {
      context.addIssue({
        code: 'custom',
        path: ['warningDiffBytes'],
        message: 'warningDiffBytes must be below hardDiffBytes',
      });
    }
  });

export const SettingsSchema = z.strictObject({
  maxParallelReviewers: z.number().int().min(1).max(3),
  reviewerTimeoutMs: z.number().int().min(30_000).max(3_600_000),
  verifierTimeoutMs: z.number().int().min(30_000).max(3_600_000),
  maxStdoutBytes: z.number().int().min(1_024).max(10_485_760),
  maxStderrBytes: z.number().int().min(1_024).max(10_485_760),
  standardsMaxBytes: z.number().int().min(1_024).max(10_485_760),
  workspaceRoot: z.string().trim().min(1).max(1_024),
  excludedGlobs: z.array(z.string().trim().min(1).max(500)).max(100),
  limits: ReviewLimitsSchema,
  defaultMain: ModelSelectionSchema.nullable(),
  defaultReviewers: z.array(ModelSelectionSchema).max(8),
  defaultAdditionalInstructions: z.string().max(10_000),
});

export const UpdateSettingsRequestSchema = SettingsSchema.partial();

export const StandardsMetadataSchema = z.strictObject({
  versionId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().nonnegative().max(1_048_576),
  uploadedAt: z.string().datetime(),
});

export const AzureAuthStatusSchema = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('pat'),
    configured: z.literal(true),
  }),
  z.strictObject({
    method: z.literal('azure_cli'),
    configured: z.literal(true),
    executablePath: z.string().trim().min(1).max(1_024),
  }),
  z.strictObject({
    method: z.literal('unavailable'),
    configured: z.literal(false),
    reason: z.literal('pat_missing_and_azure_cli_unavailable'),
  }),
]);

export const DEFAULT_SETTINGS = {
  maxParallelReviewers: 3,
  reviewerTimeoutMs: 600_000,
  verifierTimeoutMs: 600_000,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  standardsMaxBytes: 1_048_576,
  workspaceRoot: 'pr-review-orchestrator/workspaces',
  excludedGlobs: [
    '**/package-lock.json',
    '**/pnpm-lock.yaml',
    '**/yarn.lock',
    '**/*.min.*',
  ],
  limits: {
    warningChangedFiles: 50,
    hardChangedFiles: 200,
    warningDiffBytes: 1_048_576,
    hardDiffBytes: 5_242_880,
    hardInspectableFileBytes: 1_048_576,
  },
  defaultMain: null,
  defaultReviewers: [],
  defaultAdditionalInstructions: '',
} as const;

export type Settings = z.infer<typeof SettingsSchema>;
export type UpdateSettingsRequest = z.infer<
  typeof UpdateSettingsRequestSchema
>;
export type StandardsMetadata = z.infer<typeof StandardsMetadataSchema>;
export type AzureAuthStatus = z.infer<typeof AzureAuthStatusSchema>;
