import type {
  ActivityTarget,
  ActivityVisibility,
  AuthenticationState,
  ModelCatalog,
  ProviderActivityAction,
  ProviderId,
  ReasoningEffort,
} from '@pr-orchestrator/contracts';

/** An executable that can be spawned with `shell: false`. */
export interface ResolvedExecutable {
  /** Absolute path of the binary to spawn (a native CLI or the Node binary). */
  executablePath: string;
  /** Arguments that must precede the CLI's own, e.g. its JavaScript entry point. */
  prefixArgs: readonly string[];
}

/** Finds provider CLIs; only PATH-discovered absolute paths are ever returned. */
export interface CliLocator {
  locate(command: ProviderId): ResolvedExecutable | undefined;
}

export interface ProviderInstallation {
  installed: boolean;
  executable?: ResolvedExecutable;
  /** Human-facing path: the CLI entry point rather than the Node binary. */
  displayPath?: string;
  version?: string;
  /** Set when the CLI is present but cannot satisfy the read-only contract. */
  unsupportedReason?: string;
}

export interface ProviderRunRequest {
  runId: string;
  model: string;
  /**
   * Requested reasoning effort, validated against the model catalog before the
   * job starts. Absent or 'default' keeps the CLI's own configured effort.
   */
  reasoningEffort?: ReasoningEffort;
  /**
   * Absolute checkout root: the process cwd (and Codex `--cd`). Finding paths
   * are relative to it.
   */
  workspacePath: string;
  /**
   * Absolute directories outside the checkout that hold read-only context
   * files (diff, metadata, technology manifest, standards snapshot). Claude
   * gets `--add-dir`, Gemini `--include-directories`; Codex's read-only
   * sandbox can already read them (its `--add-dir` would grant write access).
   */
  readOnlyDirectories?: readonly string[];
  /** Sent through stdin; never placed on the command line. */
  prompt: string;
  /** Absolute path of the JSON Schema the final answer must satisfy. */
  outputSchemaPath: string;
  timeoutMs: number;
  signal: AbortSignal;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  /** Receives normalized, sanitized activity while the provider runs. */
  activity?: ProviderActivitySink;
}

/**
 * One observable provider action. Built only from allowlisted fields of the
 * CLI's structured event stream: never model text, prompts, tool output or
 * command arguments. `target.path` is checkout-relative and validated.
 */
export interface ProviderActivityObservation {
  action: ProviderActivityAction;
  /** Allowlisted tool identifier, e.g. `Read`, `read_file`, `shell`. */
  tool?: string;
  target?: ActivityTarget;
}

/**
 * Callbacks an adapter invokes during `runReview`. Implementations must not
 * throw; adapters also guard every call so a sink can never fail a run.
 */
export interface ProviderActivitySink {
  /** Called once per invocation, right before the process is spawned. */
  visibility(visibility: ActivityVisibility): void;
  activity(observation: ProviderActivityObservation): void;
  /** Called after the process ends when malformed or oversized stream lines were ignored. */
  skipped(count: number): void;
}

export type ProviderFailureKind =
  | 'not_installed'
  | 'unsupported'
  | 'invalid_request'
  | 'authentication'
  | 'model_unavailable'
  | 'output_truncated'
  | 'process';

export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** Actionable, secret-free, length-bounded. */
  message: string;
  /** Process exit code when the CLI ran and exited; `null` when it was terminated. */
  exitCode?: number | null;
  /**
   * Redacted, bounded tail of the CLI's error output for the run log. CLIs print
   * banners first and the fatal error last, so the tail carries the cause.
   */
  diagnostics?: string;
}

interface ProviderRunBase {
  provider: ProviderId;
  runId: string;
  durationMs: number;
}

export type ProviderRunResult =
  | (ProviderRunBase & {
      status: 'completed';
      /** Provider's final-result channel, ANSI-stripped, before schema parsing. */
      rawOutput: string;
      /** Redacted stderr for bounded diagnostics. */
      stderr: string;
    })
  | (ProviderRunBase & { status: 'failed'; failure: ProviderFailure })
  | (ProviderRunBase & { status: 'timed_out' })
  | (ProviderRunBase & { status: 'cancelled' });

export interface ProviderAdapter {
  readonly id: ProviderId;
  detectInstallation(): Promise<ProviderInstallation>;
  checkAuthentication(): Promise<AuthenticationState>;
  listModels(): Promise<ModelCatalog>;
  runReview(request: ProviderRunRequest): Promise<ProviderRunResult>;
  cancel(runId: string): Promise<void>;
}
