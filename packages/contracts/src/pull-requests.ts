import { z } from 'zod';

export const PullRequestAuthorSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
});

export const PullRequestSummarySchema = z.strictObject({
  url: z.string().url(),
  organization: z.string().trim().min(1).max(200),
  project: z.string().trim().min(1).max(200),
  repository: z.string().trim().min(1).max(300),
  pullRequestId: z.number().int().positive(),
  title: z.string().trim().min(1).max(500),
  author: PullRequestAuthorSchema,
  sourceBranch: z.string().trim().min(1).max(500),
  targetBranch: z.string().trim().min(1).max(500),
  sourceCommit: z.string().regex(/^[a-fA-F0-9]{7,64}$/),
  targetCommit: z.string().regex(/^[a-fA-F0-9]{7,64}$/),
  changedFiles: z.number().int().nonnegative(),
  /** Null until the pinned merge-base-to-source diff is available. */
  additions: z.number().int().nonnegative().nullable(),
  deletions: z.number().int().nonnegative().nullable(),
  updatedAt: z.string().datetime(),
});

export const ValidatePullRequestRequestSchema = z.strictObject({
  url: z.string().url(),
});

export type PullRequestSummary = z.infer<typeof PullRequestSummarySchema>;
export type ValidatePullRequestRequest = z.infer<
  typeof ValidatePullRequestRequestSchema
>;
