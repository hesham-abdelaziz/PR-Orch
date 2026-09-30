import type {
  ModelSelection,
  PullRequestSummary,
  Settings,
  StandardsMetadata,
} from '@pr-orchestrator/contracts';

import type { ProviderAdapter } from '../providers/provider-adapter.js';
import type { CoverageExclusion } from './entities/review-job.entity.js';

/**
 * Narrow ports for the platform services the engine consumes. The platform
 * (Codex) binds its concrete services to these tokens in the application module.
 */
export const REVIEW_WORKSPACE_PORT = Symbol('REVIEW_WORKSPACE_PORT');
export const REVIEW_STANDARDS_PORT = Symbol('REVIEW_STANDARDS_PORT');
export const REVIEW_SETTINGS_PORT = Symbol('REVIEW_SETTINGS_PORT');
export const REVIEW_PULL_REQUEST_PORT = Symbol('REVIEW_PULL_REQUEST_PORT');
export const REVIEW_PROVIDER_PORT = Symbol('REVIEW_PROVIDER_PORT');

export interface StandardsSnapshotForReview {
  metadata: StandardsMetadata;
  /** Absolute path of the immutable, hash-addressed copy providers read. */
  storagePath: string;
}

export interface PreparedWorkspace {
  workspaceId: string;
  /**
   * Absolute, platform-managed workspace directory for this job. It holds the
   * context files (diff, metadata, technology manifest) and may or may not
   * contain the checkout. It is never the provider working directory unless it
   * equals `checkoutPath`. Providers get read-only access to it when a context
   * file lives here but outside the checkout.
   */
  rootPath: string;
  /**
   * Required. Absolute root of the source-revision checkout: the provider
   * working directory, the root every finding path is relative to, and the
   * tree finding locations are validated against. Same path flavor (Windows
   * drive or POSIX) as every other path here; no UNC paths.
   */
  checkoutPath: string;
  sourceCommit: string;
  targetCommit: string;
  /** Absolute paths; inside `rootPath` (preferred) or inside the checkout. */
  diffPath: string;
  metadataPath: string;
  technologyManifestPath: string;
  /** Absolute path of the job's standards copy, or null to use the snapshot's `storagePath`. */
  standardsPath: string | null;
  exclusions: CoverageExclusion[];
  warnings: string[];
}

export interface PrepareWorkspaceInput {
  reviewId: string;
  pullRequest: PullRequestSummary;
  standards: StandardsSnapshotForReview | null;
}

export interface ReviewWorkspacePort {
  prepare(input: PrepareWorkspaceInput, signal: AbortSignal): Promise<PreparedWorkspace>;
  /** Idempotent: cleaning an already-removed workspace succeeds. */
  cleanup(workspaceId: string): Promise<void>;
}

export interface ReviewStandardsPort {
  /** Captures the active standards version, or null when none is uploaded. */
  snapshotForReview(reviewId: string): Promise<StandardsSnapshotForReview | null>;
}

export interface ReviewSettingsPort {
  get(): Promise<Settings>;
}

export interface PullRequestValidationPort {
  validate(url: string): Promise<PullRequestSummary>;
}

/** Satisfied by `ProviderRegistryService`. */
export interface ReviewProviderPort {
  assertSelectable(selection: ModelSelection): Promise<void>;
  getAdapter(id: ModelSelection['provider']): ProviderAdapter;
}
