# PR Review Orchestrator Claude Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the safe local-provider execution engine, multi-reviewer orchestration, main-verifier pipeline, and canonical report backend.

**Architecture:** Provider-specific behavior is isolated behind a shared adapter contract and a bounded Windows process supervisor. The review module persists explicit state transitions, normalizes reviewer output, runs one main verifier after reviewers settle, and emits typed SSE events. The report module accepts only verifier output that passes the shared schema.

**Tech Stack:** NestJS 12, TypeScript, Node child processes, Zod shared contracts, TypeORM entities supplied through the platform migration, Server-Sent Events, Vitest, fake CLI fixtures.

**Spec:** `docs/superpowers/specs/2026-09-29-pr-review-orchestrator-design.md`

## Global Constraints

- Start only from the Codex Task 1 contract-gate commit.
- Edit only `apps/api/src/providers/**`, `apps/api/src/reviews/**`, `apps/api/src/reports/**`, and `tests/fixtures/fake-clis/**`.
- Use the shared Zod schemas; do not duplicate DTO interfaces.
- No provider receives the Azure PAT or unrestricted inherited environment.
- All processes use absolute executables, argument arrays, `shell: false`, timeouts, output caps, and process-tree cancellation.
- Claude runs restricted/plan mode, Codex runs read-only sandbox mode, and Gemini runs plan mode.
- One malformed structured response receives one correction attempt only.
- One or more successful reviewers permits verification; zero successful reviewers fails the job.
- The main verifier must accept, reject, or merge every candidate finding with evidence.
- Do not implement numeric confidence, consensus, risk scores, patch application, or Azure/repository writes.

## Review Focus

- A child that spawns grandchildren and ignores normal termination must be killed as a tree; Task 1.
- ANSI noise, JSONL events, partial output, and oversized output must not become unvalidated findings; Tasks 1 and 3.
- A cancellation racing with reviewer completion must end in one valid terminal state; Task 4.
- Provider authentication or model errors must be actionable without exposing environment secrets; Task 2.
- The verifier must not silently omit, invent, or misattribute candidate findings; Tasks 3 and 4.

---

### Task 1: Bounded Windows process supervisor and fake CLIs

**Files:**
- Create: `apps/api/src/providers/process/process-runner.types.ts`
- Create: `apps/api/src/providers/process/process-supervisor.service.ts`
- Create: `apps/api/src/providers/process/environment-policy.ts`
- Create: `apps/api/src/providers/process/output-buffer.ts`
- Create: `apps/api/src/providers/process/process-tree-killer.ts`
- Create: `tests/fixtures/fake-clis/fake-cli.mjs`
- Create: `tests/fixtures/fake-clis/scenarios.ts`
- Test: `apps/api/src/providers/process/process-supervisor.service.spec.ts`
- Test: `apps/api/src/providers/process/environment-policy.spec.ts`

**Interfaces:**
- Consumes: Absolute executable path, argument array, working directory, stdin string, timeout, output limit, cancellation signal, and environment allowlist.
- Produces: `ProcessSupervisor.run(request: ProcessRunRequest): Promise<ProcessRunResult>` and `ProcessSupervisor.cancel(runId: string): Promise<void>`.

```ts
interface ProcessRunRequest {
  runId: string;
  executablePath: string;
  args: readonly string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  environment: Readonly<Record<string, string>>;
  signal: AbortSignal;
}
```

- [ ] **Step 1: Write failing supervisor tests**

Test stdout/stderr capture, stdin delivery, exit code, timeout, explicit cancellation, descendant termination, ANSI stripping, UTF-8 boundary handling, and independent stdout/stderr byte caps.

- [ ] **Step 2: Write failing environment-policy tests**

Assert the child receives required system variables plus provider auth variables, but never variables whose normalized names contain `AZURE`, `PAT`, `TOKEN` outside the provider allowlist, `PASSWORD`, or application session secrets.

- [ ] **Step 3: Run the process tests to verify failure**

Run: `npm --workspace apps/api test -- providers/process`

Expected: FAIL because the supervisor does not exist.

- [ ] **Step 4: Implement fake CLI scenarios**

Support `success`, `stderr`, `malformed`, `hang`, `spawn-child`, `oversized`, and `auth-failure` modes selected by arguments. Emit deterministic fixtures matching the shared schemas.

- [ ] **Step 5: Implement bounded process execution**

Use `child_process.spawn` with `shell: false`, write the prompt through stdin, cap buffers while continuing to drain pipes, sanitize ANSI output, and return a discriminated result for completed, failed, timed out, or cancelled.

- [ ] **Step 6: Implement Windows process-tree cancellation**

Terminate descendants and parent idempotently. Normal cancellation gets a short grace period, then force termination. Tests must prove no fixture child remains alive.

- [ ] **Step 7: Run supervisor tests**

Run: `npm --workspace apps/api test -- providers/process`

Expected: PASS with no orphan fake CLI process.

- [ ] **Step 8: Commit the process supervisor**

```bash
git add apps/api/src/providers/process tests/fixtures/fake-clis
git commit -m "feat: supervise local AI CLI processes"
```

### Task 2: Provider registry and Claude, Codex, Gemini adapters

**Files:**
- Create: `apps/api/src/providers/provider-adapter.ts`
- Create: `apps/api/src/providers/provider-registry.service.ts`
- Create: `apps/api/src/providers/model-catalog.service.ts`
- Create: `apps/api/src/providers/windows-cli-resolver.ts`
- Create: `apps/api/src/providers/providers.controller.ts`
- Create: `apps/api/src/providers/providers.module.ts`
- Create: `apps/api/src/providers/adapters/claude.adapter.ts`
- Create: `apps/api/src/providers/adapters/codex.adapter.ts`
- Create: `apps/api/src/providers/adapters/gemini.adapter.ts`
- Create: `apps/api/src/providers/adapters/adapter-command-policy.ts`
- Test: `apps/api/src/providers/provider-registry.service.spec.ts`
- Test: `apps/api/src/providers/adapters/claude.adapter.spec.ts`
- Test: `apps/api/src/providers/adapters/codex.adapter.spec.ts`
- Test: `apps/api/src/providers/adapters/gemini.adapter.spec.ts`

**Interfaces:**
- Consumes: `ProcessSupervisor`, `ProviderStatusSchema`, configured adapter model catalogs, and `ProviderRunRequest`.
- Produces: `ProviderAdapter.detectInstallation`, `checkAuthentication`, `listModels`, `runReview`, and `cancel`; `GET /api/providers`; `POST /api/providers/refresh`.

```ts
interface ProviderRunRequest {
  runId: string;
  model: string;
  workspacePath: string;
  prompt: string;
  outputSchemaPath: string;
  timeoutMs: number;
  signal: AbortSignal;
}
```

- [ ] **Step 1: Write failing registry tests**

Cover absolute-path discovery, duplicate executable precedence, version parsing, stale snapshot refresh, missing provider, unauthenticated provider, unsupported CLI version, adapter-maintained versus dynamically discovered model catalogs, and safe resolution of npm `.cmd` shims.

- [ ] **Step 2: Write failing command-policy tests**

Assert exact safe profiles:

- Claude: non-interactive JSON, JSON schema, restricted tools, plan permission mode, no permission prompts, and no session persistence.
- Codex: `exec`, stdin prompt, `--sandbox read-only`, `--ask-for-approval never`, `--ephemeral`, output schema, and explicit working directory.
- Gemini: headless JSON output, `--approval-mode plan`, sandbox enabled when supported, explicit model, and no YOLO or auto-edit mode.

- [ ] **Step 3: Run adapter tests to verify failure**

Run: `npm --workspace apps/api test -- providers/adapters provider-registry`

Expected: FAIL because adapters are missing.

- [ ] **Step 4: Implement installation and authentication probes**

Resolve native executables directly. Resolve npm `.cmd` shims to the installed JavaScript entry point and invoke it through the absolute current Node executable so `shell: false` remains enforceable. Prefer Codex's native executable when both native and npm shims exist. Then use `claude --version` plus `claude auth status`, `codex --version` plus `codex login status`, and `gemini --version` plus non-billable local configuration inspection. If Gemini auth cannot be established without a model request, report `unknown_until_run` rather than consuming usage.

- [ ] **Step 5: Implement model catalogs**

Return CLI-discovered models when a stable supported command exists. Otherwise return adapter-maintained aliases plus locally configured model names, mark the discovery mode, and validate the chosen model at execution. Never claim a hard-coded entry is account-authorized before execution.

- [ ] **Step 6: Implement adapters**

Build only safe argument arrays, pass prompts by stdin, request structured output where supported, normalize provider errors, and delegate timeout/cancellation to `ProcessSupervisor`.

- [ ] **Step 7: Run registry and adapter tests**

Run: `npm --workspace apps/api test -- providers`

Expected: PASS; tests assert no write-capable flags and no prompt text in process arguments.

- [ ] **Step 8: Commit provider adapters**

```bash
git add apps/api/src/providers
git commit -m "feat: add local AI provider adapters"
```

### Task 3: Review prompts, structured output, and finding normalization

**Files:**
- Create: `apps/api/src/reviews/prompts/core-review-policy.ts`
- Create: `apps/api/src/reviews/prompts/reviewer-prompt.builder.ts`
- Create: `apps/api/src/reviews/prompts/verifier-prompt.builder.ts`
- Create: `apps/api/src/reviews/prompts/correction-prompt.builder.ts`
- Create: `apps/api/src/reviews/output/provider-output.parser.ts`
- Create: `apps/api/src/reviews/output/finding-normalizer.service.ts`
- Create: `apps/api/src/reviews/output/finding-path.validator.ts`
- Test: `apps/api/src/reviews/prompts/reviewer-prompt.builder.spec.ts`
- Test: `apps/api/src/reviews/prompts/verifier-prompt.builder.spec.ts`
- Test: `apps/api/src/reviews/output/provider-output.parser.spec.ts`
- Test: `apps/api/src/reviews/output/finding-normalizer.service.spec.ts`

**Interfaces:**
- Consumes: Prepared workspace metadata, standards snapshot/fallback warning, optional user instructions, provider/model identity, and shared finding schemas.
- Produces: `ReviewerPromptBuilder.build(input): string`, `VerifierPromptBuilder.build(input): string`, `ProviderOutputParser.parseReviewer`, `parseVerifier`, and normalized candidate findings with stable IDs.

- [ ] **Step 1: Write failing prompt-policy tests**

Assert prompts require static inspection, direct evidence, explicit exclusions, standards precedence, source disclosure for version-specific guidance, no repository mutation, and strict structured output. Assert optional instructions cannot remove these rules.

- [ ] **Step 2: Write failing adversarial-output tests**

Cover fenced JSON, provider JSON envelopes, JSONL final events, prose before/after JSON, unknown fields, invalid severities, absolute paths, traversal paths, missing evidence, duplicate candidates, and oversized fields.

- [ ] **Step 3: Run prompt/output tests to verify failure**

Run: `npm --workspace apps/api test -- reviews/prompts reviews/output`

Expected: FAIL because builders and parsers are missing.

- [ ] **Step 4: Implement immutable core prompt policy**

Compose prompts from protected core policy, job context, standards/fallback guidance, and optional instructions in that order. Delimit user-controlled and repository-derived text as data, not instructions.

- [ ] **Step 5: Implement provider-output parsing**

Extract only the provider's final result channel, parse JSON once, validate with strict shared schemas, and return a typed correction-needed error without guessing missing fields.

- [ ] **Step 6: Implement finding normalization**

Normalize relative paths, reject paths outside the checkout, bound text fields, attach origin metadata, and compute a stable candidate ID from provider, model, normalized path, location, and title.

- [ ] **Step 7: Run prompt/output tests**

Run: `npm --workspace apps/api test -- reviews/prompts reviews/output`

Expected: PASS, including all adversarial fixtures.

- [ ] **Step 8: Commit prompt and normalization layer**

```bash
git add apps/api/src/reviews/prompts apps/api/src/reviews/output
git commit -m "feat: normalize evidence-backed review findings"
```

### Task 4: Orchestration, verification, reports, history, and SSE

**Files:**
- Create: `apps/api/src/reviews/entities/review-job.entity.ts`
- Create: `apps/api/src/reviews/entities/reviewer-run.entity.ts`
- Create: `apps/api/src/reviews/entities/candidate-finding.entity.ts`
- Create: `apps/api/src/reviews/entities/final-finding.entity.ts`
- Create: `apps/api/src/reports/entities/report.entity.ts`
- Create: `apps/api/src/reviews/job-state-machine.ts`
- Create: `apps/api/src/reviews/review-lock.service.ts`
- Create: `apps/api/src/reviews/review-orchestrator.service.ts`
- Create: `apps/api/src/reviews/review-events.service.ts`
- Create: `apps/api/src/reviews/reviews.controller.ts`
- Create: `apps/api/src/reviews/reviews.module.ts`
- Create: `apps/api/src/reports/report-renderer.service.ts`
- Create: `apps/api/src/reports/report-query.service.ts`
- Create: `apps/api/src/reports/reports.module.ts`
- Test: `apps/api/src/reviews/job-state-machine.spec.ts`
- Test: `apps/api/src/reviews/review-orchestrator.service.spec.ts`
- Test: `apps/api/src/reviews/review-lock.service.spec.ts`
- Test: `apps/api/src/reports/report-renderer.service.spec.ts`
- Test: `apps/api/src/reports/report-query.service.spec.ts`

**Interfaces:**
- Consumes: Provider registry/adapters, prompt/parser layer, workspace/settings/standards interfaces from Codex, and shared review schemas.
- Produces: Locked review HTTP routes, typed `ReviewEventSchema` SSE events, immutable structured reports, sanitized Markdown downloads, and startup recovery hooks.

- [ ] **Step 1: Write failing state and lock tests**

Assert only legal job transitions, terminal-state idempotence, simultaneous `createReview` calls creating one active job, cancellation/completion race resolution, and database-backed lock recovery after restart.

- [ ] **Step 2: Write failing orchestration tests**

Cover all reviewers succeeding, one timeout plus one success, one malformed result corrected, all reviewers failing, verifier malformed then corrected, verifier failing, cancellation, concurrency cap, and standards snapshot stability during replacement.

- [ ] **Step 3: Write failing report tests**

Assert finding ordering by severity/location, required sections, reviewer origins, standards/fallback warning, partial-failure warning, exclusions, no-findings state, all-claims-rejected state, collapsed audit data, raw-HTML escaping, unsafe-link removal, and immutable history filters.

- [ ] **Step 4: Run orchestration/report tests to verify failure**

Run: `npm --workspace apps/api test -- reviews reports`

Expected: FAIL because entities and services do not exist.

- [ ] **Step 5: Implement state machine and active-job lock**

Persist every transition transactionally. Enforce at most one non-terminal job using a database uniqueness strategy plus an in-process mutex; do not rely on the UI.

- [ ] **Step 6: Implement orchestration**

Prepare the workspace, snapshot standards, run reviewers through a bounded concurrency queue, perform at most one correction attempt, require one success, run the main verifier, persist every outcome, and always schedule cleanup.

- [ ] **Step 7: Implement cancellation and SSE**

Abort queued/running providers, terminate process trees, emit monotonic typed events, finish in `cancelled`, and close streams cleanly. Reconnecting clients receive the current snapshot before live events.

- [ ] **Step 8: Implement canonical reports and history**

Render Markdown from validated verifier JSON rather than model-authored raw Markdown. Sanitize links/HTML, disclose warnings and exclusions, preserve immutable JSON/Markdown, and implement search/filter queries.

- [ ] **Step 9: Run the engine gate**

Run: `npm --workspace apps/api test -- providers reviews reports`

Expected: PASS with deterministic fake CLIs and no leaked fixture secrets.

- [ ] **Step 10: Commit the review engine**

```bash
git add apps/api/src/reviews apps/api/src/reports
git commit -m "feat: orchestrate verified multi-model reviews"
```

### Task 5: Engine self-review and handoff

**Files:**
- Modify: engine files only when a new regression test proves a defect
- Create: `apps/api/src/providers/README.md`
- Create: `apps/api/src/reviews/README.md`

**Interfaces:**
- Consumes: Completed Claude engine test suite.
- Produces: A reviewed branch and concise integration notes for Codex.

- [ ] **Step 1: Audit every provider command profile**

Confirm prompts stay off command lines, write-capable modes are absent, environment inheritance is minimized, and version/capability failures disable providers safely.

- [ ] **Step 2: Audit verifier invariants**

Trace every candidate through accept, reject, or merge; confirm origins, evidence, severity, and audit counts remain consistent.

- [ ] **Step 3: Add regression tests for any verified defect**

Each accepted issue gets a failing test before its fix. Do not change behavior for speculative concerns.

- [ ] **Step 4: Run the engine gate again**

Run: `npm --workspace apps/api test -- providers reviews reports`

Expected: PASS.

- [ ] **Step 5: Commit reviewed engine and hand off**

```bash
git add apps/api/src/providers apps/api/src/reviews apps/api/src/reports tests/fixtures/fake-clis
git commit -m "docs: document review engine contracts"
```

Send Codex the branch, commit hash, commands run, migration/entity requirements, and intentionally deferred behaviors.

