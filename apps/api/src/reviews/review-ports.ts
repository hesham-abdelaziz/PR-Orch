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
  /** Workspace directory: the provider working directory; it holds the checkout and context files. */
  rootPath: string;
  /** Repository checkout directory; defaults to `rootPath` when absent. */
  checkoutPath?: string;
  sourceCommit: string;
  targetCommit: string;
  diffPath: string;
  metadataPath: string;
  technologyManifestPath: string;
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
