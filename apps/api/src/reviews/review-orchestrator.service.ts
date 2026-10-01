import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  CreateReviewRequestSchema,
  RUN_ACTIVITY_SNAPSHOT_PER_RUN,
  type ActivityOutcome,
  type CreateReviewRequest,
  type ModelSelection,
  type ReviewFinding,
  type ReviewJob,
  type RunState,
} from '@pr-orchestrator/contracts';

import type {
  ProviderAdapter,
  ProviderRunRequest,
  ProviderRunResult,
} from '../providers/provider-adapter.js';
import { boundedSnippet, collectSecretValues, redactSecrets } from '../providers/redact-secrets.js';
import { ProviderNotSelectableError } from '../providers/provider-registry.service.js';
import { ReportRenderer } from '../reports/report-renderer.service.js';
import type { CandidateFindingRecord } from './entities/candidate-finding.entity.js';
import type { CoverageExclusion, JobPatch, ReviewJobRecord } from './entities/review-job.entity.js';
import type { ReviewerRunRecord } from './entities/reviewer-run.entity.js';
import { ReviewEventsService } from './review-events.service.js';
import { RunActivityRecorder } from './run-activity.recorder.js';
import { RunLivenessService } from './run-liveness.service.js';
import { ActiveReviewExistsError, ReviewNotFoundError } from './review-errors.js';
import { JobStateMachine, isTerminal } from './job-state-machine.js';
import { toReviewJob } from './review-job.mapper.js';
import {
  REVIEW_PROVIDER_PORT,
  REVIEW_PULL_REQUEST_PORT,
  REVIEW_SETTINGS_PORT,
  REVIEW_STANDARDS_PORT,
  REVIEW_WORKSPACE_PORT,
  type PreparedWorkspace,
  type PullRequestValidationPort,
  type ReviewProviderPort,
  type ReviewSettingsPort,
  type ReviewStandardsPort,
  type ReviewWorkspacePort,
} from './review-ports.js';
import { REVIEW_REPOSITORY, type ReviewRepository } from './review-repository.js';
import { ReviewLockService } from './review-lock.service.js';
import { FindingNormalizerService } from './output/finding-normalizer.service.js';
import { ProviderOutputParser, type CorrectionNeededError } from './output/provider-output.parser.js';
import { redactModelOutput } from './output/redact-model-output.js';
import {
  FileSystemCheckoutInspectorFactory,
  type CheckoutInspector,
  type CheckoutInspectorFactory,
} from './output/checkout-inspector.js';
import { checkFindingLocation } from './output/finding-evidence.validator.js';
import {
  REVIEWER_OUTPUT_JSON_SCHEMA_TEXT,
  VERIFIER_OUTPUT_JSON_SCHEMA_TEXT,
} from './output/provider-json-schema.js';
import type { PromptStandards } from './prompts/core-review-policy.js';
import { CorrectionPromptBuilder } from './prompts/correction-prompt.builder.js';
import { ReviewerPromptBuilder } from './prompts/reviewer-prompt.builder.js';
import { VerifierPromptBuilder } from './prompts/verifier-prompt.builder.js';
import { assembleVerifiedReport } from './verifier-report.assembler.js';
import { WorkspaceLayoutError, resolveWorkspaceLayout, type WorkspaceLayout } from './workspace-layout.js';

export const REVIEW_ORCHESTRATOR_OPTIONS = Symbol('REVIEW_ORCHESTRATOR_OPTIONS');

export interface ReviewOrchestratorOptions {
  clock?: () => Date;
  idFactory?: () => string;
  /** Directory for per-job scratch files (JSON schemas); defaults to the OS temp dir. */
  scratchRoot?: string;
  /**
   * Exact secret values to redact in addition to the credential patterns, e.g.
   * the saved Azure PAT. Defaults to secret-looking environment variables.
   */
  secretValues?: () => readonly string[];
  /** Read-only access to prepared checkouts for location and evidence checks. */
  checkoutInspectors?: CheckoutInspectorFactory;
  /** Interval of process heartbeats while a provider runs; defaults to 15 s. */
  heartbeatIntervalMs?: number;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const FINISHED_RUN_STATES: ReadonlySet<RunState> = new Set(['completed', 'failed', 'timed_out', 'cancelled']);

/** The product-wide ceiling on concurrent reviewer processes. */
export const MAX_REVIEWER_PROCESSES = 3;
const MAX_LOG_CHARACTERS = 4_096;
const MAX_STDERR_IN_LOG = 1_500;
const MAX_JOB_WARNINGS = 100;
const FAILABLE_STAGES: ReadonlySet<string> = new Set(['queued', 'preparing', 'reviewing', 'verifying', 'rendering']);
const MAX_REVIEWER_WARNINGS = 5;

interface Runtime {
  readonly jobId: string;
  readonly controller: AbortController;
  /** Provider run id -> adapter, for process-tree cancellation. */
  readonly activeRuns: Map<string, ProviderAdapter>;
  workspaceId: string | null;
  scratchDir: string | null;
  warnings: string[];
  exclusions: CoverageExclusion[];
  done: Promise<void>;
}

/** A prepared workspace plus its single, validated interpretation. */
interface ReadyWorkspace {
  prepared: PreparedWorkspace;
  layout: WorkspaceLayout;
  /** Reads the immutable checkout; finding locations are validated against it. */
  inspector: CheckoutInspector;
  /** Paths the workspace excluded from detailed inspection (trusted metadata). */
  excludedPaths: ReadonlySet<string>;
}

interface ReviewerOutcome {
  run: ReviewerRunRecord;
  findings: ReviewFinding[];
  exclusions: CoverageExclusion[];
  warnings: string[];
}

const label = (selection: ModelSelection): string => `${selection.provider}/${selection.model}`;

/**
 * Coordinates one review from creation to a terminal state: prepares the
 * workspace, fans out to reviewers (bounded), verifies candidates with the main
 * verifier, renders the canonical report, and always cleans up.
 */
@Injectable()
export class ReviewOrchestratorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly runtimes = new Map<string, Runtime>();
  private readonly stateMachine: JobStateMachine;
  private readonly lock: ReviewLockService;
  private readonly clock: () => Date;
  private readonly newId: () => string;
  private readonly scratchRoot: string;
  private readonly secretValues: () => readonly string[];
  private readonly checkoutInspectors: CheckoutInspectorFactory;
  private readonly activity: RunActivityRecorder;
  private readonly liveness: RunLivenessService;
  private readonly heartbeatIntervalMs: number;

  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly repository: ReviewRepository,
    @Inject(REVIEW_WORKSPACE_PORT) private readonly workspace: ReviewWorkspacePort,
    @Inject(REVIEW_STANDARDS_PORT) private readonly standards: ReviewStandardsPort,
    @Inject(REVIEW_SETTINGS_PORT) private readonly settings: ReviewSettingsPort,
    @Inject(REVIEW_PULL_REQUEST_PORT) private readonly pullRequests: PullRequestValidationPort,
    @Inject(REVIEW_PROVIDER_PORT) private readonly providers: ReviewProviderPort,
    @Inject(ReviewEventsService) private readonly events: ReviewEventsService,
    @Inject(ReportRenderer) private readonly renderer: ReportRenderer,
    @Inject(ProviderOutputParser) private readonly parser: ProviderOutputParser,
    @Inject(FindingNormalizerService) private readonly normalizer: FindingNormalizerService,
    @Inject(ReviewerPromptBuilder) private readonly reviewerPrompts: ReviewerPromptBuilder,
    @Inject(VerifierPromptBuilder) private readonly verifierPrompts: VerifierPromptBuilder,
    @Inject(CorrectionPromptBuilder) private readonly correctionPrompts: CorrectionPromptBuilder,
    @Optional() @Inject(REVIEW_ORCHESTRATOR_OPTIONS) options: ReviewOrchestratorOptions = {},
    @Optional() @Inject(RunLivenessService) liveness: RunLivenessService = new RunLivenessService(),
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.newId = options.idFactory ?? randomUUID;
    this.scratchRoot = options.scratchRoot ?? tmpdir();
    this.secretValues = options.secretValues ?? (() => collectSecretValues(process.env));
    this.checkoutInspectors = options.checkoutInspectors ?? new FileSystemCheckoutInspectorFactory();
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.liveness = liveness;
    this.activity = new RunActivityRecorder(repository, events, liveness, this.clock);
    this.stateMachine = new JobStateMachine(repository, this.clock);
    this.lock = new ReviewLockService(repository, this.stateMachine);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverOnStartup();
  }

  /** On shutdown, cancel running reviews so no provider process outlives the app. */
  async onModuleDestroy(): Promise<void> {
    const ids = [...this.runtimes.keys()];
    await Promise.allSettled(ids.map((id) => this.cancelReview(id)));
    await Promise.allSettled(ids.map((id) => this.awaitCompletion(id)));
  }

  // ---------------------------------------------------------------- creation

  async createReview(input: CreateReviewRequest): Promise<ReviewJob> {
    const request = CreateReviewRequestSchema.parse(input);

    const already = await this.repository.getActiveJob();
    if (already) throw new ActiveReviewExistsError(already.id);

    for (const selection of [request.main, ...request.reviewers]) {
      try {
        await this.providers.assertSelectable(selection);
      } catch (error) {
        // Provider status text can carry CLI diagnostics; it reaches HTTP responses.
        if (error instanceof ProviderNotSelectableError) {
          throw new ProviderNotSelectableError(redactSecrets(error.message, this.secretValues()));
        }
        throw error;
      }
    }
    const pullRequest = await this.pullRequests.validate(request.pullRequestUrl);
    const settings = await this.settings.get();

    const id = this.newId();
    const now = this.clock().toISOString();
    const runs: ReviewerRunRecord[] = [
      ...request.reviewers.map((selection) => this.newRun(id, 'reviewer', selection)),
      this.newRun(id, 'verifier', request.main),
    ];

    const created = await this.lock.runExclusive(async () => {
      // Re-check under the lock so losers never take a standards snapshot.
      const active = await this.repository.getActiveJob();
      if (active) return { created: false as const, activeJobId: active.id };

      const snapshot = await this.standards.snapshotForReview(id);
      const instructions = (request.additionalInstructions ?? settings.defaultAdditionalInstructions).trim();
      const record: ReviewJobRecord = {
        id,
        state: 'queued',
        pullRequest,
        main: request.main,
        reviewers: request.reviewers,
        additionalInstructions: instructions.length > 0 ? instructions : null,
        standards: snapshot?.metadata ?? null,
        standardsStoragePath: snapshot?.storagePath ?? null,
        settings,
        warnings: [],
        exclusions: [],
        failureReason: null,
        workspaceId: null,
        cleanupPending: false,
        overallRisk: null,
        findingCount: null,
        eventSequence: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };

      return this.repository.createJob(record, runs);
    });
    if (!created.created) throw new ActiveReviewExistsError(created.activeJobId);

    const runtime: Runtime = {
      jobId: id,
      controller: new AbortController(),
      activeRuns: new Map(),
      workspaceId: null,
      scratchDir: null,
      warnings: [],
      exclusions: [],
      done: Promise.resolve(),
    };
    this.runtimes.set(id, runtime);
    runtime.done = this.execute(runtime).finally(() => this.runtimes.delete(id));

    return toReviewJob(created.job, runs);
  }

  /** Resolves when the background pipeline for a review has fully finished. */
  awaitCompletion(reviewId: string): Promise<void> {
    return this.runtimes.get(reviewId)?.done ?? Promise.resolve();
  }

  // ------------------------------------------------------------ cancellation

  async cancelReview(reviewId: string): Promise<ReviewJob> {
    const record = await this.repository.getJob(reviewId);
    if (!record) throw new ReviewNotFoundError(reviewId);
    if (isTerminal(record.state)) return this.snapshot(reviewId);

    const result = await this.stateMachine.transition(reviewId, 'cancelling');
    if (result.applied) this.events.jobStateChanged(reviewId, 'cancelling');

    const runtime = this.runtimes.get(reviewId);
    if (runtime) {
      runtime.controller.abort();
      await Promise.allSettled(
        [...runtime.activeRuns].map(([runId, adapter]) => adapter.cancel(runId)),
      );
    } else if (result.applied || result.job?.state === 'cancelling') {
      // No pipeline in this process (e.g. orphaned by a crash): finish directly.
      await this.settleUnfinishedRuns(reviewId, null);
      const done = await this.stateMachine.transition(reviewId, 'cancelled');
      if (done.applied) this.events.jobStateChanged(reviewId, 'cancelled');
      await this.cleanupWorkspace(reviewId, record.workspaceId);
      await this.events.flush(reviewId);
    }

    return this.snapshot(reviewId);
  }

  // ---------------------------------------------------------------- recovery

  /** Fails jobs stranded by a restart and retries any pending workspace cleanup. */
  async recoverOnStartup(): Promise<void> {
    await this.lock.recoverAfterRestart();
    await this.retryPendingCleanups();
  }

  async retryPendingCleanups(): Promise<void> {
    for (const job of await this.repository.listJobsPendingCleanup()) {
      if (this.runtimes.has(job.id)) continue;
      await this.cleanupWorkspace(job.id, job.workspaceId);
    }
  }

  // ---------------------------------------------------------------- pipeline

  private async execute(ctx: Runtime): Promise<void> {
    try {
      await this.pipeline(ctx);
    } catch (error) {
      await this.failUnexpected(ctx, error);
    } finally {
      await this.cleanupWorkspace(ctx.jobId, ctx.workspaceId);
      if (ctx.scratchDir) await rm(ctx.scratchDir, { recursive: true, force: true }).catch(() => undefined);
      await this.events.flush(ctx.jobId);
    }
  }

  private async pipeline(ctx: Runtime): Promise<void> {
    if (!(await this.advance(ctx, 'preparing'))) return;

    const record = await this.mustGet(ctx.jobId);
    const ready = await this.prepareWorkspace(ctx, record);
    if (!ready) return;

    ctx.scratchDir = await mkdtemp(join(this.scratchRoot, 'pr-review-'));
    await writeFile(join(ctx.scratchDir, 'reviewer-output.schema.json'), REVIEWER_OUTPUT_JSON_SCHEMA_TEXT, 'utf8');
    await writeFile(join(ctx.scratchDir, 'verifier-output.schema.json'), VERIFIER_OUTPUT_JSON_SCHEMA_TEXT, 'utf8');

    if (!(await this.advance(ctx, 'reviewing'))) return;

    const outcomes = await this.runReviewers(ctx, record, ready);
    if (ctx.controller.signal.aborted) return this.finishCancelled(ctx);

    const succeeded = outcomes.filter((outcome) => outcome.run.state === 'completed');
    if (succeeded.length === 0) {
      const reasons = outcomes
        .map((outcome) => `${label(outcome.run.selection)}: ${outcome.run.warning ?? outcome.run.state}`)
        .join('; ');

      return this.fail(ctx, `All reviewers failed. ${reasons}`);
    }

    const reviewerWarnings = outcomes.flatMap((outcome) => outcome.warnings);
    ctx.warnings = [...ctx.warnings, ...reviewerWarnings];
    ctx.exclusions = mergeExclusions(ctx.exclusions, outcomes.flatMap((outcome) => outcome.exclusions));

    const candidates = outcomes.flatMap((outcome) => outcome.findings);
    await this.repository.saveCandidates(
      outcomes.flatMap((outcome) =>
        outcome.findings.map<CandidateFindingRecord>((finding) => ({
          id: finding.id,
          jobId: ctx.jobId,
          runId: outcome.run.id,
          finding,
        })),
      ),
    );
    await this.repository.updateJob(
      ctx.jobId,
      { warnings: ctx.warnings, exclusions: ctx.exclusions },
      this.clock().toISOString(),
    );
    // Emitted only after the warnings are persisted, so a snapshot taken at a
    // later sequence always contains them.
    for (const warning of reviewerWarnings) this.events.warning(ctx.jobId, 'reviewer_partial', warning);

    const verified = await this.verify(ctx, record, ready, candidates, reviewerWarnings);
    if (!verified) return;

    await this.render(ctx, record, candidates, verified);
  }

  private async prepareWorkspace(ctx: Runtime, record: ReviewJobRecord): Promise<ReadyWorkspace | null> {
    let prepared: PreparedWorkspace;
    try {
      prepared = await this.workspace.prepare(
        {
          reviewId: ctx.jobId,
          pullRequest: record.pullRequest,
          standards:
            record.standards && record.standardsStoragePath
              ? { metadata: record.standards, storagePath: record.standardsStoragePath }
              : null,
        },
        ctx.controller.signal,
      );
    } catch (error) {
      if (ctx.controller.signal.aborted) {
        await this.finishCancelled(ctx);
      } else {
        await this.fail(ctx, `Workspace preparation failed: ${this.safeText(error)}`);
      }

      return null;
    }

    ctx.workspaceId = prepared.workspaceId;
    ctx.warnings = [...prepared.warnings];
    ctx.exclusions = mergeExclusions([], prepared.exclusions);
    await this.repository.updateJob(
      ctx.jobId,
      {
        workspaceId: prepared.workspaceId,
        cleanupPending: true,
        exclusions: ctx.exclusions,
        warnings: ctx.warnings,
      },
      this.clock().toISOString(),
    );

    if (ctx.controller.signal.aborted) {
      await this.finishCancelled(ctx);

      return null;
    }

    let layout: WorkspaceLayout;
    try {
      layout = resolveWorkspaceLayout(prepared, record.standards ? this.standardsPathOf(record, prepared) : null);
    } catch (error) {
      if (!(error instanceof WorkspaceLayoutError)) throw error;
      await this.fail(ctx, `The prepared workspace layout is invalid: ${this.safeText(error)}`);

      return null;
    }

    return {
      prepared,
      layout,
      inspector: this.checkoutInspectors.forCheckout(layout.checkoutRoot),
      excludedPaths: new Set(prepared.exclusions.map((exclusion) => exclusion.path)),
    };
  }

  // --------------------------------------------------------------- reviewers

  private async runReviewers(
    ctx: Runtime,
    record: ReviewJobRecord,
    ready: ReadyWorkspace,
  ): Promise<ReviewerOutcome[]> {
    const runs = (await this.repository.listRuns(ctx.jobId)).filter((run) => run.role === 'reviewer');
    const limit = Math.min(MAX_REVIEWER_PROCESSES, Math.max(1, record.settings.maxParallelReviewers));

    return this.pool(runs, limit, async (run) => {
      try {
        return await this.runReviewer(ctx, record, ready, run);
      } catch (error) {
        return this.reviewerFailure(run, `Reviewer failed unexpectedly: ${this.safeText(error)}`, 'failed');
      }
    });
  }

  private async runReviewer(
    ctx: Runtime,
    record: ReviewJobRecord,
    ready: ReadyWorkspace,
    initial: ReviewerRunRecord,
  ): Promise<ReviewerOutcome> {
    const selection = initial.selection;
    const tag = label(selection);

    if (ctx.controller.signal.aborted) {
      return {
        run: await this.saveRun(initial, { state: 'cancelled', completedAt: this.now(), sanitizedLog: 'Cancelled before it started.' }),
        findings: [],
        exclusions: [],
        warnings: [],
      };
    }

    let run = await this.saveRun(initial, { state: 'running', startedAt: this.now() });
    const adapter = this.providers.getAdapter(selection.provider);
    const checkout = ready.layout.checkoutRoot;
    const basePrompt = this.reviewerPrompts.build({
      reviewer: selection,
      pullRequest: record.pullRequest,
      workspace: this.promptWorkspace(ready, ctx.warnings),
      standards: this.promptStandards(record, ready),
      ...(record.additionalInstructions ? { additionalInstructions: record.additionalInstructions } : {}),
    });
    const log: string[] = [];
    let prompt = basePrompt;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await this.invoke(ctx, adapter, selection.provider, {
        runId: attempt === 1 ? run.id : `${run.id}-c${attempt - 1}`,
        model: selection.model,
        // Every attempt, including correction retries, keeps the run's effort.
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
        workspacePath: checkout,
        readOnlyDirectories: ready.layout.readOnlyDirectories,
        prompt,
        outputSchemaPath: this.schemaPath(ctx, 'reviewer'),
        timeoutMs: record.settings.reviewerTimeoutMs,
        signal: ctx.controller.signal,
        maxStdoutBytes: record.settings.maxStdoutBytes,
        maxStderrBytes: record.settings.maxStderrBytes,
      }, { runId: run.id, attempt });
      run = { ...run, attempts: attempt };

      if (result.status !== 'completed') {
        log.push(...describeUnfinishedAttempt(attempt, result, record.settings.reviewerTimeoutMs));

        return this.reviewerEnded(run, result, record.settings.reviewerTimeoutMs, tag, log);
      }
      log.push(`attempt ${attempt} stderr: ${boundedSnippet(result.stderr, MAX_STDERR_IN_LOG)}`);

      const parsed = this.parser.parseReviewer({ provider: selection.provider, rawOutput: result.rawOutput });
      this.activity.attemptEnded(run.id, attempt, parsed.ok ? 'completed' : 'invalid_output');
      if (parsed.ok) {
        const { result: shaped, dropped } = this.normalizer.normalizeReviewer({
          reviewer: selection,
          workspaceRoot: checkout,
          // Redacted once here, so candidates, run results, the verifier prompt,
          // reports, logs and events only ever see redacted model text.
          output: redactModelOutput(parsed.value, this.secretValues()),
        });
        const located = await this.keepLocatable(shaped.findings, ready);
        const normalized = { ...shaped, findings: located.kept };
        const warnings: string[] = [];
        if (dropped.length > 0) {
          warnings.push(`Reviewer ${tag} discarded ${dropped.length} finding(s) or exclusion(s) with invalid paths or fields.`);
        }
        if (located.discarded.length > 0) {
          warnings.push(
            `Reviewer ${tag} discarded ${located.discarded.length} finding(s) whose file or line range does not exist or is not inspectable in the checkout (${this.safeText(located.discarded.slice(0, 3).join('; '), 400)}).`,
          );
        }
        for (const warning of normalized.warnings.slice(0, MAX_REVIEWER_WARNINGS)) {
          warnings.push(`Reviewer ${tag}: ${this.safeText(warning)}`);
        }

        return {
          run: await this.saveRun(run, {
            state: 'completed',
            completedAt: this.now(),
            result: normalized,
            sanitizedLog: this.makeLog(log),
          }),
          findings: normalized.findings,
          exclusions: normalized.exclusions,
          warnings,
        };
      }

      log.push(describeCorrection(attempt, parsed.error));
      if (attempt === 1) {
        prompt = this.correctionPrompts.build({
          originalPrompt: basePrompt,
          issues: parsed.error.issues,
          previousOutput: result.rawOutput,
        });
      }
    }

    return this.reviewerFailure(
      run,
      'Returned invalid structured output twice.',
      'failed',
      `Reviewer ${tag} returned invalid structured output twice; results are partial.`,
      log,
    );
  }

  private async reviewerEnded(
    run: ReviewerRunRecord,
    result: Exclude<ProviderRunResult, { status: 'completed' }>,
    timeoutMs: number,
    tag: string,
    log: string[],
  ): Promise<ReviewerOutcome> {
    if (result.status === 'cancelled') {
      return {
        run: await this.saveRun(run, { state: 'cancelled', completedAt: this.now(), sanitizedLog: this.makeLog(log) }),
        findings: [],
        exclusions: [],
        warnings: [],
      };
    }
    if (result.status === 'timed_out') {
      return this.reviewerFailure(
        run,
        `Timed out after ${Math.round(timeoutMs / 1_000)} s.`,
        'timed_out',
        `Reviewer ${tag} timed out; results are partial.`,
        log,
      );
    }
    const message = this.safeText(result.failure.message, 500) || 'The provider failed.';

    return this.reviewerFailure(run, message, 'failed', `Reviewer ${tag} failed: ${message}; results are partial.`, log);
  }

  private async reviewerFailure(
    run: ReviewerRunRecord,
    warning: string,
    state: Extract<RunState, 'failed' | 'timed_out'>,
    jobWarning?: string,
    log: string[] = [],
  ): Promise<ReviewerOutcome> {
    return {
      run: await this.saveRun(run, {
        state,
        completedAt: this.now(),
        warning: warning.slice(0, 1_000),
        sanitizedLog: this.makeLog(log),
      }),
      findings: [],
      exclusions: [],
      warnings: [jobWarning ?? `Reviewer ${label(run.selection)} failed: ${warning}; results are partial.`],
    };
  }

  // ---------------------------------------------------------------- verifier

  private async verify(
    ctx: Runtime,
    record: ReviewJobRecord,
    ready: ReadyWorkspace,
    candidates: ReviewFinding[],
    reviewerWarnings: string[],
  ): Promise<VerifiedOutcome | null> {
    const verifierRun = (await this.repository.listRuns(ctx.jobId)).find((run) => run.role === 'verifier');
    if (!verifierRun) throw new Error('Verifier run row is missing.');
    const checkout = ready.layout.checkoutRoot;
    const assembleWith = (output: { summary: string; decisions: never[]; warnings: string[] } | VerifierOutputLike) =>
      assembleVerifiedReport({
        reviewId: ctx.jobId,
        output: output as VerifierOutputLike,
        candidates,
        workspaceRoot: checkout,
        jobWarnings: ctx.warnings,
        exclusions: ctx.exclusions,
        excludedPaths: ready.excludedPaths,
        normalizer: this.normalizer,
        inspector: ready.inspector,
      });

    if (!(await this.advance(ctx, 'verifying', { warnings: ctx.warnings, exclusions: ctx.exclusions }))) return null;

    if (candidates.length === 0) {
      const empty = await assembleWith({ summary: 'No reviewer reported candidate findings.', decisions: [], warnings: [] });
      if (!empty.ok) throw new Error('Could not assemble an empty report.');
      await this.saveRun(verifierRun, {
        state: 'completed',
        completedAt: this.now(),
        sanitizedLog: 'Skipped: reviewers reported no candidate findings.',
      });

      return empty;
    }

    const selection = record.main;
    const tag = label(selection);
    let run = await this.saveRun(verifierRun, { state: 'running', startedAt: this.now() });
    const adapter = this.providers.getAdapter(selection.provider);
    const basePrompt = this.verifierPrompts.build({
      verifier: selection,
      pullRequest: record.pullRequest,
      workspace: this.promptWorkspace(ready, ready.prepared.warnings),
      standards: this.promptStandards(record, ready),
      candidates,
      jobWarnings: reviewerWarnings,
    });
    const log: string[] = [];
    let prompt = basePrompt;
    let lastIssue = 'unknown';

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await this.invoke(ctx, adapter, selection.provider, {
        runId: attempt === 1 ? run.id : `${run.id}-c${attempt - 1}`,
        model: selection.model,
        // Every attempt, including correction retries, keeps the run's effort.
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
        workspacePath: checkout,
        readOnlyDirectories: ready.layout.readOnlyDirectories,
        prompt,
        outputSchemaPath: this.schemaPath(ctx, 'verifier'),
        timeoutMs: record.settings.verifierTimeoutMs,
        signal: ctx.controller.signal,
        maxStdoutBytes: record.settings.maxStdoutBytes,
        maxStderrBytes: record.settings.maxStderrBytes,
      }, { runId: run.id, attempt });
      run = { ...run, attempts: attempt };
      if (result.status !== 'completed') {
        log.push(...describeUnfinishedAttempt(attempt, result, record.settings.verifierTimeoutMs));
      }

      if (result.status === 'cancelled') {
        await this.saveRun(run, { state: 'cancelled', completedAt: this.now(), sanitizedLog: this.makeLog(log) });
        await this.finishCancelled(ctx);

        return null;
      }
      if (result.status === 'timed_out') {
        await this.saveRun(run, {
          state: 'timed_out',
          completedAt: this.now(),
          warning: `Timed out after ${Math.round(record.settings.verifierTimeoutMs / 1_000)} s.`,
          sanitizedLog: this.makeLog(log),
        });
        await this.fail(ctx, `Main verifier ${tag} timed out; no verified report could be produced.`);

        return null;
      }
      if (result.status === 'failed') {
        const message = this.safeText(result.failure.message, 500) || 'The provider failed.';
        await this.saveRun(run, { state: 'failed', completedAt: this.now(), warning: message, sanitizedLog: this.makeLog(log) });
        await this.fail(ctx, `Main verifier ${tag} failed: ${message}`);

        return null;
      }

      log.push(`attempt ${attempt} stderr: ${boundedSnippet(result.stderr, MAX_STDERR_IN_LOG)}`);
      const parsed = this.parser.parseVerifier({ provider: selection.provider, rawOutput: result.rawOutput });
      let issues: string[];
      if (parsed.ok) {
        const assembled = await assembleWith(redactModelOutput(parsed.value, this.secretValues()));
        this.activity.attemptEnded(run.id, attempt, assembled.ok ? 'completed' : 'invalid_output');
        if (assembled.ok) {
          await this.saveRun(run, { state: 'completed', completedAt: this.now(), sanitizedLog: this.makeLog(log) });

          return assembled;
        }
        issues = assembled.issues;
        log.push(`attempt ${attempt}: integrity violations: ${issues.length}`);
      } else {
        this.activity.attemptEnded(run.id, attempt, 'invalid_output');
        issues = parsed.error.issues;
        log.push(describeCorrection(attempt, parsed.error));
      }
      lastIssue = issues[0] ?? lastIssue;

      if (attempt === 1) {
        prompt = this.correctionPrompts.build({ originalPrompt: basePrompt, issues, previousOutput: result.rawOutput });
      }
    }

    await this.saveRun(run, {
      state: 'failed',
      completedAt: this.now(),
      warning: 'Returned an unusable verification twice.',
      sanitizedLog: this.makeLog(log),
    });
    await this.fail(
      ctx,
      `Main verifier ${tag} did not return a valid, complete verification after one correction attempt (${this.safeText(lastIssue, 200)}).`,
    );

    return null;
  }

  // ------------------------------------------------------------------ render

  private async render(
    ctx: Runtime,
    record: ReviewJobRecord,
    candidates: ReviewFinding[],
    verified: VerifiedOutcome,
  ): Promise<void> {
    if (!(await this.advance(ctx, 'rendering'))) return;

    const fresh = await this.mustGet(ctx.jobId);
    const runs = await this.repository.listRuns(ctx.jobId);
    const now = this.now();
    const durationMs = Math.max(0, Date.parse(now) - Date.parse(record.createdAt));
    const markdown = this.renderer.render({
      job: toReviewJob({ ...fresh, warnings: verified.report.warnings }, runs),
      report: verified.report,
      candidates,
      durationMs,
    });

    const completed = await this.repository.completeJob({
      jobId: ctx.jobId,
      report: { jobId: ctx.jobId, report: verified.report, markdown, durationMs, createdAt: now },
      finalFindings: verified.finalFindings.map((entry) => ({ ...entry, jobId: ctx.jobId })),
      patch: {
        overallRisk: verified.report.overallRisk,
        findingCount: verified.report.findings.length,
        warnings: verified.report.warnings,
        exclusions: verified.report.exclusions,
      },
      at: now,
    });

    if (completed.applied) {
      this.events.jobStateChanged(ctx.jobId, 'completed');
    } else if (completed.job?.state === 'cancelling') {
      await this.finishCancelled(ctx);
    }
  }

  // ----------------------------------------------------------- state helpers

  private async advance(ctx: Runtime, to: 'preparing' | 'reviewing' | 'verifying' | 'rendering', patch?: JobPatch): Promise<boolean> {
    const result = await this.stateMachine.transition(ctx.jobId, to, patch);
    if (result.applied) {
      this.events.jobStateChanged(ctx.jobId, to);

      return true;
    }
    if (result.job?.state === 'cancelling') await this.finishCancelled(ctx);

    return false;
  }

  private async fail(ctx: Runtime, reason: string): Promise<void> {
    // The job's state when it fails is the stage that failed; later stages never
    // ran. Recording it keeps "failed in reviewing" distinct from "all failed".
    const stage = await this.repository
      .getJob(ctx.jobId)
      .then((job) => job?.state)
      .catch(() => undefined);
    const failureReason = this.safeText(
      stage === undefined || !FAILABLE_STAGES.has(stage) ? reason : `Failed during ${stage}: ${reason}`,
      1_000,
    );
    await this.settleUnfinishedRuns(ctx.jobId, 'Not run because the review failed.');
    // Warnings are the job's client-visible diagnostics channel.
    ctx.warnings = [...ctx.warnings, failureReason].slice(-MAX_JOB_WARNINGS);
    const result = await this.stateMachine.transition(ctx.jobId, 'failed', {
      failureReason,
      warnings: ctx.warnings,
    });
    if (result.applied) {
      // Emitted after the reason is persisted, so a later snapshot contains it.
      this.events.warning(ctx.jobId, 'job_failed', failureReason);
      this.events.jobStateChanged(ctx.jobId, 'failed');
    } else if (result.job?.state === 'cancelling') await this.finishCancelled(ctx);
  }

  private async failUnexpected(ctx: Runtime, error: unknown): Promise<void> {
    try {
      await this.fail(ctx, `Internal error while running the review: ${this.safeText(error)}`);
    } catch {
      // Nothing more can be done; startup recovery fails any job left active.
    }
  }

  private async finishCancelled(ctx: Runtime): Promise<void> {
    await this.settleUnfinishedRuns(ctx.jobId, null);
    const result = await this.stateMachine.transition(ctx.jobId, 'cancelled');
    if (result.applied) this.events.jobStateChanged(ctx.jobId, 'cancelled');
  }

  private async settleUnfinishedRuns(jobId: string, warning: string | null): Promise<void> {
    for (const run of await this.repository.listRuns(jobId)) {
      if (run.state === 'queued' || run.state === 'running') {
        await this.saveRun(run, { state: 'cancelled', completedAt: this.now(), warning });
      }
    }
  }

  private async cleanupWorkspace(jobId: string, workspaceId: string | null): Promise<void> {
    if (!workspaceId) return;

    try {
      await this.workspace.cleanup(workspaceId);
      await this.repository.updateJob(jobId, { cleanupPending: false }, this.now());
    } catch (error) {
      const job = await this.repository.getJob(jobId);
      const warning = `Workspace cleanup failed and will be retried: ${this.safeText(error, 200)}`;
      const warnings = job && !job.warnings.some((known) => known.startsWith('Workspace cleanup failed'))
        ? [...job.warnings, warning]
        : (job?.warnings ?? []);
      await this.repository.updateJob(jobId, { cleanupPending: true, warnings }, this.now());
    }
  }

  // ----------------------------------------------------------------- helpers

  /**
   * Runs one provider attempt. With `tracked`, the attempt is recorded as run
   * activity: start and (unless it completed, which the caller classifies after
   * parsing) its end, the adapter's observations, and a process heartbeat every
   * `heartbeatIntervalMs` while it runs.
   */
  private async invoke(
    ctx: Runtime,
    adapter: ProviderAdapter,
    provider: ModelSelection['provider'],
    request: ProviderRunRequest,
    tracked?: { runId: string; attempt: number },
  ): Promise<ProviderRunResult> {
    ctx.activeRuns.set(request.runId, adapter);
    let heartbeat: NodeJS.Timeout | undefined;
    if (tracked) {
      this.activity.attemptStarted(tracked.runId, tracked.attempt);
      heartbeat = setInterval(() => this.activity.heartbeat(tracked.runId), this.heartbeatIntervalMs);
      heartbeat.unref();
    }

    let result: ProviderRunResult;
    try {
      result = request.signal.aborted
        ? { provider, runId: request.runId, durationMs: 0, status: 'cancelled' }
        : await adapter.runReview(
            tracked ? { ...request, activity: this.activity.sink(tracked.runId, tracked.attempt) } : request,
          );
    } catch (error) {
      result = {
        provider,
        runId: request.runId,
        durationMs: 0,
        status: 'failed',
        failure: { kind: 'process', message: this.safeText(error, 300) },
      };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      ctx.activeRuns.delete(request.runId);
    }

    if (tracked && result.status !== 'completed') {
      this.activity.attemptEnded(tracked.runId, tracked.attempt, result.status satisfies ActivityOutcome);
    }

    return result;
  }

  private async pool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = Array.from({ length: items.length });
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await worker(items[index] as T);
      }
    });
    await Promise.all(lanes);

    return results;
  }

  private newRun(jobId: string, role: 'reviewer' | 'verifier', selection: ModelSelection): ReviewerRunRecord {
    return {
      id: this.newId(),
      jobId,
      role,
      selection,
      state: 'queued',
      startedAt: null,
      completedAt: null,
      warning: null,
      attempts: 0,
      sanitizedLog: '',
      result: null,
    };
  }

  private async saveRun(run: ReviewerRunRecord, patch: Partial<ReviewerRunRecord>): Promise<ReviewerRunRecord> {
    const next = { ...run, ...patch };
    const changed = patch.state !== undefined && patch.state !== run.state;
    // A finished run's activity is fully persisted and announced before its final state.
    if (changed && FINISHED_RUN_STATES.has(patch.state as RunState)) await this.activity.finish(run.id);
    await this.repository.saveRun(next);
    if (changed && patch.state === 'running') {
      this.activity.begin({ jobId: run.jobId, runId: run.id, role: run.role }, run.activity);
    }
    if (changed) {
      this.events.reviewerStateChanged(run.jobId, run.id, patch.state as RunState, run.selection, {
        role: run.role,
        startedAt: next.startedAt,
        completedAt: next.completedAt,
      });
    }

    return next;
  }

  /** Candidates must cite an existing, inspectable file and line range; others are unverifiable. */
  private async keepLocatable(
    findings: readonly ReviewFinding[],
    ready: ReadyWorkspace,
  ): Promise<{ kept: ReviewFinding[]; discarded: string[] }> {
    const kept: ReviewFinding[] = [];
    const discarded: string[] = [];
    for (const finding of findings) {
      const check = await checkFindingLocation(finding, ready.inspector, ready.excludedPaths);
      if (check.ok) kept.push(finding);
      else discarded.push(check.issue);
    }

    return { kept, discarded };
  }

  private promptWorkspace(ready: ReadyWorkspace, warnings: readonly string[]) {
    return {
      checkoutRoot: ready.layout.checkoutRoot,
      contextFiles: ready.layout.contextFiles,
      exclusions: ready.prepared.exclusions,
      warnings,
    };
  }

  private promptStandards(record: ReviewJobRecord, ready: ReadyWorkspace): PromptStandards {
    if (!record.standards) return { kind: 'fallback' };
    const file = ready.layout.contextFiles.find((entry) => entry.label === 'Project standards snapshot');

    return {
      kind: 'snapshot',
      filename: record.standards.filename,
      sha256: record.standards.sha256,
      path: file?.path ?? this.standardsPathOf(record, ready.prepared),
    };
  }

  private standardsPathOf(record: ReviewJobRecord, prepared: PreparedWorkspace): string {
    return prepared.standardsPath ?? record.standardsStoragePath ?? '';
  }

  private schemaPath(ctx: Runtime, kind: 'reviewer' | 'verifier'): string {
    if (!ctx.scratchDir) throw new Error('Scratch directory is not ready.');

    return join(ctx.scratchDir, `${kind}-output.schema.json`);
  }

  private makeLog(lines: readonly string[]): string {
    return redactSecrets(lines.join('\n'), this.secretValues()).slice(0, MAX_LOG_CHARACTERS);
  }

  /** Redacted, single-line, bounded text for warnings, failure reasons and logs. */
  private safeText(value: unknown, max = 300): string {
    const text = value instanceof Error ? value.message : String(value);

    return boundedSnippet(redactSecrets(text, this.secretValues()), max);
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private async mustGet(jobId: string): Promise<ReviewJobRecord> {
    const record = await this.repository.getJob(jobId);
    if (!record) throw new Error('Review job disappeared.');

    return record;
  }

  private async snapshot(reviewId: string): Promise<ReviewJob> {
    const record = await this.mustGet(reviewId);

    return toReviewJob(record, await this.repository.listRuns(reviewId), {
      entries: await this.repository.listRunActivity(reviewId, RUN_ACTIVITY_SNAPSHOT_PER_RUN),
      lastHeartbeat: (runId) => this.liveness.lastHeartbeat(runId),
    });
  }
}

type VerifierOutputLike = Parameters<typeof assembleVerifiedReport>[0]['output'];
type VerifiedOutcome = Extract<Awaited<ReturnType<typeof assembleVerifiedReport>>, { ok: true }>;

function describeCorrection(attempt: number, error: CorrectionNeededError): string {
  return `attempt ${attempt}: ${error.reason}${error.issues.length > 0 ? ` (${error.issues.slice(0, 3).join('; ')})` : ''}`;
}

function mergeExclusions(
  base: readonly CoverageExclusion[],
  extra: readonly CoverageExclusion[],
): CoverageExclusion[] {
  const seen = new Set<string>();
  const merged: CoverageExclusion[] = [];

  for (const exclusion of [...base, ...extra]) {
    const key = `${exclusion.path}\u0000${exclusion.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(exclusion);
  }

  return merged.slice(0, 1_000);
}

/** Sanitized-log lines for an attempt that ended without output; redacted again by makeLog. */
function describeUnfinishedAttempt(
  attempt: number,
  result: Exclude<ProviderRunResult, { status: 'completed' }>,
  timeoutMs: number,
): string[] {
  switch (result.status) {
    case 'cancelled':
      return [`attempt ${attempt}: cancelled after ${result.durationMs} ms`];
    case 'timed_out':
      return [`attempt ${attempt}: timed out after ${Math.round(timeoutMs / 1_000)} s; the process tree was terminated`];
    case 'failed': {
      const { failure } = result;
      const exit =
        failure.exitCode === undefined
          ? 'exit status unavailable'
          : failure.exitCode === null
            ? 'terminated without an exit code'
            : `exit code ${failure.exitCode}`;
      const lines = [`attempt ${attempt}: ${result.provider} failed (${failure.kind}, ${exit}) after ${result.durationMs} ms`];
      if (failure.diagnostics) {
        const text = failure.diagnostics;
        lines.push(
          `attempt ${attempt} stderr (tail): ${text.length <= MAX_STDERR_IN_LOG ? text : `…${text.slice(text.length - MAX_STDERR_IN_LOG + 1)}`}`,
        );
      }

      return lines;
    }
  }
}
