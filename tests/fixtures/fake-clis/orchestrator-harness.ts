import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  CreateReviewRequest,
  ModelSelection,
  ProviderId,
  ReviewFinding,
  Settings,
} from '@pr-orchestrator/contracts';

import type {
  ProviderAdapter,
  ProviderRunRequest,
  ProviderRunResult,
} from '../../../apps/api/src/providers/provider-adapter.js';
import { ProviderNotSelectableError } from '../../../apps/api/src/providers/provider-registry.service.js';
import { ReportRenderer } from '../../../apps/api/src/reports/report-renderer.service.js';
import { FindingNormalizerService } from '../../../apps/api/src/reviews/output/finding-normalizer.service.js';
import { PROTOCOL_AREAS } from '../../../apps/api/src/reviews/prompts/review-protocol.js';
import { ProviderOutputParser } from '../../../apps/api/src/reviews/output/provider-output.parser.js';
import { InMemoryReviewRepository } from '../../../apps/api/src/reviews/in-memory-review.repository.js';
import { CorrectionPromptBuilder } from '../../../apps/api/src/reviews/prompts/correction-prompt.builder.js';
import { ReviewerPromptBuilder } from '../../../apps/api/src/reviews/prompts/reviewer-prompt.builder.js';
import { VerifierPromptBuilder } from '../../../apps/api/src/reviews/prompts/verifier-prompt.builder.js';
import { ReviewEventsService } from '../../../apps/api/src/reviews/review-events.service.js';
import { ReviewOrchestratorService } from '../../../apps/api/src/reviews/review-orchestrator.service.js';
import { RunLivenessService } from '../../../apps/api/src/reviews/run-liveness.service.js';
import type {
  PrepareWorkspaceInput,
  PreparedWorkspace,
  PullRequestValidationPort,
  ReviewProviderPort,
  ReviewSettingsPort,
  ReviewStandardsPort,
  ReviewWorkspacePort,
  StandardsSnapshotForReview,
} from '../../../apps/api/src/reviews/review-ports.js';
import { pullRequest, settings as makeSettings, uuid } from './engine-fixtures.js';
import { InMemoryCheckout, syntheticSource } from './in-memory-checkout.js';
import type { CheckoutInspectorFactory } from '../../../apps/api/src/reviews/output/checkout-inspector.js';

export const CODEX: ModelSelection = { provider: 'codex', model: 'cli-default' };
export const GEMINI: ModelSelection = { provider: 'gemini', model: 'pro' };
export const CLAUDE: ModelSelection = { provider: 'claude', model: 'opus' };
export const CHECKOUT = '/work/job/checkout';

export interface WireFinding {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  filePath: string;
  location: { startLine: number; endLine: number | null; description: string | null };
  evidence: string;
  impact: string;
  suggestedFix: string;
  reference: string | null;
}

export function wireFinding(overrides: Partial<WireFinding> = {}): WireFinding {
  return {
    title: 'Unchecked null dereference in loader',
    severity: 'high',
    filePath: 'src/loader.ts',
    location: { startLine: 12, endLine: 14, description: null },
    evidence: 'Line 12 reads `config.value` without a null check.',
    impact: 'The loader throws for empty configuration.',
    suggestedFix: 'Guard config before reading value.',
    reference: null,
    ...overrides,
  };
}

export type WireCoverage = { area: string; status: 'checked' | 'not_applicable'; note: string };

/** Full coverage of the fixed protocol areas, as a well-behaved reviewer reports it. */
export function fullCoverage(): WireCoverage[] {
  return PROTOCOL_AREAS.map((area) => ({ area: area.id, status: 'checked', note: `Examined ${area.title}.` }));
}

export function reviewerJson(
  findings: WireFinding[] = [wireFinding()],
  extra: {
    warnings?: string[];
    exclusions?: Array<{ path: string; reason: string }>;
    coverage?: WireCoverage[];
  } = {},
): string {
  return JSON.stringify({
    findings,
    warnings: extra.warnings ?? [],
    exclusions: extra.exclusions ?? [],
    coverage: extra.coverage ?? fullCoverage(),
  });
}

export type WireDecision = {
  candidateIds: string[];
  verdict: 'accepted' | 'rejected' | 'merged';
  rationale: string;
  locationCorrection?: string | null;
  finding: WireFinding | null;
};

export function verifierJson(decisions: WireDecision[], summary = 'Verified the reported claims.', warnings: string[] = []): string {
  return JSON.stringify({
    summary,
    decisions: decisions.map((decision) => ({ ...decision, locationCorrection: decision.locationCorrection ?? null })),
    warnings,
  });
}

export function toWire(candidate: ReviewFinding): WireFinding {
  return wireFinding({
    title: candidate.title,
    severity: candidate.severity,
    filePath: candidate.filePath,
    location: {
      startLine: candidate.location.startLine,
      endLine: candidate.location.endLine ?? null,
      description: candidate.location.description ?? null,
    },
    evidence: candidate.evidence,
    impact: candidate.impact,
    suggestedFix: candidate.suggestedFix,
    reference: candidate.reference ?? null,
  });
}

/** Parses the candidate list back out of a verifier prompt, as a real model would read it. */
export function candidatesFromPrompt(prompt: string): ReviewFinding[] {
  const match = /<<<BEGIN UNTRUSTED CANDIDATE_FINDINGS [0-9a-f]+>>>\n([\s\S]*?)\n<<<END UNTRUSTED CANDIDATE_FINDINGS/u.exec(prompt);
  if (!match?.[1]) throw new Error('verifier prompt has no candidate block');

  return JSON.parse(match[1]) as ReviewFinding[];
}

/** A verifier that accepts every candidate unchanged. */
export function acceptAll(prompt: string): string {
  return verifierJson(
    candidatesFromPrompt(prompt).map((candidate) => ({
      candidateIds: [candidate.id],
      verdict: 'accepted' as const,
      rationale: 'Confirmed in the code.',
      finding: toWire(candidate),
    })),
  );
}

export function completed(provider: ProviderId, request: ProviderRunRequest, rawOutput: string, stderr = ''): ProviderRunResult {
  return { provider, runId: request.runId, durationMs: 5, status: 'completed', rawOutput, stderr };
}

export function timedOut(provider: ProviderId, request: ProviderRunRequest): ProviderRunResult {
  return { provider, runId: request.runId, durationMs: request.timeoutMs, status: 'timed_out' };
}

export function failed(provider: ProviderId, request: ProviderRunRequest, message: string): ProviderRunResult {
  return { provider, runId: request.runId, durationMs: 5, status: 'failed', failure: { kind: 'process', message } };
}

export class Gate {
  private release: () => void = () => undefined;
  readonly opened = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  open(): void {
    this.release();
  }
}

export type Script = (request: ProviderRunRequest, callIndex: number) => ProviderRunResult | Promise<ProviderRunResult>;

export interface ConcurrencyProbe {
  active: number;
  max: number;
}

export class ScriptedAdapter implements ProviderAdapter {
  readonly calls: ProviderRunRequest[] = [];
  readonly cancelledRuns: string[] = [];

  constructor(
    readonly id: ProviderId,
    public script: Script,
    private readonly probe: ConcurrencyProbe = { active: 0, max: 0 },
  ) {}

  detectInstallation(): Promise<never> {
    return Promise.reject(new Error('not used by the orchestrator'));
  }
  checkAuthentication(): Promise<never> {
    return Promise.reject(new Error('not used by the orchestrator'));
  }
  listModels(): Promise<never> {
    return Promise.reject(new Error('not used by the orchestrator'));
  }

  async runReview(request: ProviderRunRequest): Promise<ProviderRunResult> {
    const index = this.calls.push(request) - 1;
    this.probe.active += 1;
    this.probe.max = Math.max(this.probe.max, this.probe.active);
    try {
      return await this.script(request, index);
    } finally {
      this.probe.active -= 1;
    }
  }

  cancel(runId: string): Promise<void> {
    this.cancelledRuns.push(runId);

    return Promise.resolve();
  }
}

/** Resolves as cancelled once the abort signal fires, like a supervised process would. */
export function hangUntilAborted(provider: ProviderId, request: ProviderRunRequest): Promise<ProviderRunResult> {
  return new Promise((resolve) => {
    const done = () => resolve({ provider, runId: request.runId, durationMs: 1, status: 'cancelled' });
    if (request.signal.aborted) done();
    else request.signal.addEventListener('abort', done, { once: true });
  });
}

export class FakeWorkspace implements ReviewWorkspacePort {
  readonly prepared: PrepareWorkspaceInput[] = [];
  readonly cleaned: string[] = [];
  prepareError: Error | null = null;
  hangPrepare = false;
  cleanupFailures = 0;
  exclusions: PreparedWorkspace['exclusions'] = [];
  warnings: string[] = [];
  /** Overrides for the prepared paths, e.g. a distinct or Windows-style layout. */
  paths: Partial<
    Pick<PreparedWorkspace, 'rootPath' | 'checkoutPath' | 'diffPath' | 'metadataPath' | 'technologyManifestPath'>
  > = {};

  async prepare(input: PrepareWorkspaceInput, signal: AbortSignal): Promise<PreparedWorkspace> {
    this.prepared.push(input);
    if (this.hangPrepare) {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new Error('aborted');
    }
    if (this.prepareError) throw this.prepareError;

    return {
      workspaceId: `ws-${input.reviewId}`,
      rootPath: '/work/job',
      checkoutPath: CHECKOUT,
      sourceCommit: input.pullRequest.sourceCommit,
      targetCommit: input.pullRequest.targetCommit,
      diffPath: '/work/job/pr.diff',
      metadataPath: '/work/job/pr.json',
      technologyManifestPath: '/work/job/tech.json',
      standardsPath: input.standards?.storagePath ?? null,
      exclusions: this.exclusions,
      warnings: this.warnings,
      ...this.paths,
    };
  }

  cleanup(workspaceId: string): Promise<void> {
    this.cleaned.push(workspaceId);
    if (this.cleanupFailures > 0) {
      this.cleanupFailures -= 1;

      return Promise.reject(new Error('EBUSY: resource busy or locked'));
    }

    return Promise.resolve();
  }
}

export class FakeStandards implements ReviewStandardsPort {
  calls = 0;
  current: StandardsSnapshotForReview | null = null;

  snapshotForReview(): Promise<StandardsSnapshotForReview | null> {
    this.calls += 1;

    return Promise.resolve(this.current);
  }
}

export function standardsSnapshot(name: string, sha: string): StandardsSnapshotForReview {
  return {
    metadata: { versionId: uuid(), filename: name, sha256: sha.repeat(64).slice(0, 64), sizeBytes: 100, uploadedAt: '2026-09-28T08:00:00.000Z' },
    storagePath: `/standards/${sha}/${name}`,
  };
}

export class FakeSettings implements ReviewSettingsPort {
  current: Settings = makeSettings();

  get(): Promise<Settings> {
    return Promise.resolve(structuredClone(this.current));
  }
}

export class FakePullRequests implements PullRequestValidationPort {
  error: Error | null = null;

  validate(): Promise<ReturnType<typeof pullRequest>> {
    return this.error ? Promise.reject(this.error) : Promise.resolve(pullRequest());
  }
}

export class FakeProviders implements ReviewProviderPort {
  readonly blocked = new Set<string>();
  /** Message of the not-selectable error; defaults to "<provider> is not ready.". */
  blockedMessage: string | null = null;

  constructor(readonly adapters: Record<ProviderId, ScriptedAdapter>) {}

  assertSelectable(selection: ModelSelection): Promise<void> {
    return this.blocked.has(`${selection.provider}/${selection.model}`)
      ? Promise.reject(new ProviderNotSelectableError(this.blockedMessage ?? `${selection.provider} is not ready.`))
      : Promise.resolve();
  }

  getAdapter(id: ProviderId): ScriptedAdapter {
    return this.adapters[id];
  }
}

export interface Harness {
  orchestrator: ReviewOrchestratorService;
  repository: InMemoryReviewRepository;
  events: ReviewEventsService;
  workspace: FakeWorkspace;
  standards: FakeStandards;
  settings: FakeSettings;
  pullRequests: FakePullRequests;
  providers: FakeProviders;
  probe: ConcurrencyProbe;
  /** The prepared checkout the engine validates finding locations against. */
  checkout: InMemoryCheckout;
  scratchRoot: string;
  /** Job states and reviewer events in emission order. */
  log: string[];
  /** Heartbeat state shared with the orchestrator, as Nest shares it with ReportQueryService. */
  liveness: RunLivenessService;
  request(overrides?: Partial<CreateReviewRequest>): CreateReviewRequest;
  scratchEntries(): Promise<string[]>;
  dispose(): Promise<void>;
}

export interface HarnessOptions {
  repository?: InMemoryReviewRepository;
  scripts?: Partial<Record<ProviderId, Script>>;
  /** Exact secret values (e.g. the Azure PAT) the orchestrator must redact. */
  secretValues?: readonly string[];
  checkout?: InMemoryCheckout;
  /** Replaces the in-memory checkout, e.g. with the real filesystem inspector. */
  checkoutInspectors?: CheckoutInspectorFactory;
  /** Process heartbeat interval while a provider runs (production default 15 s). */
  heartbeatIntervalMs?: number;
  /** Standards file contents by path; unknown paths read as missing. */
  standardsFiles?: Record<string, string>;
}

const neverConfigured: Script = (request) => {
  throw new Error(`unexpected provider call for ${request.model}`);
};

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const probe: ConcurrencyProbe = { active: 0, max: 0 };
  const adapters = {
    claude: new ScriptedAdapter('claude', options.scripts?.claude ?? neverConfigured, probe),
    codex: new ScriptedAdapter('codex', options.scripts?.codex ?? neverConfigured, probe),
    gemini: new ScriptedAdapter('gemini', options.scripts?.gemini ?? neverConfigured, probe),
  };
  const repository = options.repository ?? new InMemoryReviewRepository();
  const scratchRoot = await mkdtemp(join(tmpdir(), 'orchestrator-test-'));
  let tick = 0;
  const clock = () => new Date(Date.parse('2026-09-29T10:00:00.000Z') + tick++ * 1_000);
  const events = new ReviewEventsService(repository, clock);
  const log: string[] = [];
  const jobStateChanged = events.jobStateChanged.bind(events);
  events.jobStateChanged = (reviewId, state) => {
    log.push(`job:${state}`);
    jobStateChanged(reviewId, state);
  };
  const reviewerStateChanged = events.reviewerStateChanged.bind(events);
  events.reviewerStateChanged = (reviewId, runId, state, reviewer, details) => {
    // Verifier transitions are logged with their role so reviewer sequences stay comparable.
    const prefix = details?.role === 'verifier' ? 'verifier' : 'run';
    log.push(`${prefix}:${reviewer.provider}/${reviewer.model}:${state}`);
    reviewerStateChanged(reviewId, runId, state, reviewer, details);
  };

  const workspace = new FakeWorkspace();
  const standards = new FakeStandards();
  const settings = new FakeSettings();
  const pullRequests = new FakePullRequests();
  const providers = new FakeProviders(adapters);
  const checkout =
    options.checkout ??
    new InMemoryCheckout({
      'src/loader.ts': syntheticSource(),
      'src/parser.ts': syntheticSource(),
      'src/style.ts': syntheticSource(),
    });

  const liveness = new RunLivenessService();
  const orchestrator = new ReviewOrchestratorService(
    repository,
    workspace,
    standards,
    settings,
    pullRequests,
    providers,
    events,
    new ReportRenderer(),
    new ProviderOutputParser(),
    new FindingNormalizerService(),
    new ReviewerPromptBuilder(),
    new VerifierPromptBuilder(),
    new CorrectionPromptBuilder(),
    {
      clock,
      scratchRoot,
      idFactory: () => uuid(),
      checkoutInspectors: options.checkoutInspectors ?? checkout,
      ...(options.secretValues ? { secretValues: () => options.secretValues ?? [] } : {}),
      ...(options.heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs: options.heartbeatIntervalMs }),
      readStandards: (path: string) => Promise.resolve(options.standardsFiles?.[path] ?? null),
    },
    liveness,
  );

  return {
    orchestrator,
    repository,
    events,
    workspace,
    standards,
    settings,
    pullRequests,
    providers,
    probe,
    checkout,
    scratchRoot,
    log,
    liveness,
    request: (overrides = {}) => ({
      pullRequestUrl: 'https://dev.azure.com/acme/shop/_git/web/pullrequest/42',
      main: CLAUDE,
      reviewers: [CODEX, GEMINI],
      ...overrides,
    }),
    scratchEntries: () => readdir(scratchRoot),
    dispose: () => rm(scratchRoot, { recursive: true, force: true }),
  };
}
