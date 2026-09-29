# PR Review Orchestrator Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Windows-local PR Review Orchestrator by splitting implementation among Codex, Claude, and Gemini without overlapping file ownership.

**Architecture:** Codex establishes the repository, contracts, platform services, and final integration. Claude owns local AI provider execution, review orchestration, verification, and canonical reporting. Gemini owns the Angular experience derived from the approved Stitch designs. Work proceeds through a contract gate, parallel implementation streams, and a final integration gate.

**Tech Stack:** Node.js 24.18+, npm 11, TypeScript, Angular 22, Angular Material/CDK, NestJS 12, SQLite with TypeORM and `better-sqlite3`, Zod, Argon2id, `just-secrets`, Server-Sent Events, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-pr-review-orchestrator-design.md`

## Global Constraints

- Windows localhost MVP; the HTTP server binds only to `127.0.0.1`.
- Exactly one active PR review job; its reviewer models may execute concurrently.
- Exactly one main verifier and one or more reviewer models per job.
- Providers are local Claude, Codex, and Gemini CLIs using their existing sessions.
- Azure authentication precedence is saved PAT first, then an existing authenticated Azure CLI session.
- The product performs static inspection only: no tests, builds, linters, dependency installation in target repositories, or target-code execution.
- No Azure comments, votes, approvals, commits, pushes, patch application, or repository mutation.
- Missing standards produce a visible warning and framework/library guidance fallback.
- One reviewer may fail without failing the job when another reviewer succeeds.
- User-visible findings require title, severity, location, evidence, impact, and suggested fix.
- Prompts, arguments, logs, reports, and SQLite must never contain the Azure PAT.
- Production code uses local assets and Angular components, not Stitch CDN scripts or remote sample assets.
- Every product-code task follows TDD and ends in a focused commit.

## Review Focus

- A malicious PR URL, uploaded filename, model path, or model output must not escape its allowed URL/path boundary; pinned by Codex Tasks 1, 2, and 3.
- A provider process that spawns descendants, hangs, or emits excessive output must be terminated and bounded; pinned by Claude Task 1.
- Simultaneous start requests must create at most one active job; pinned by Claude Task 3.
- Replacing standards during a running job must not change that job's snapshot or historical report; pinned by Codex Task 2 and Claude Task 3.
- A report containing raw HTML, unsafe links, or misleading complete-coverage language must render safely and disclose exclusions; pinned by Claude Task 4 and Gemini Task 5.

---

## Ownership rationale

### Codex: platform and integration owner

Codex takes the tasks with the highest repository-wide and operating-system integration load: monorepo scaffolding, shared contracts, persistence, authentication, Windows secrets, Azure access, Git workspace isolation, security regression tests, and final end-to-end integration.

### Claude: orchestration and review-quality owner

Claude takes the reasoning-heavy backend: provider adapters, safe process supervision, prompt contracts, structured-output recovery, job state transitions, multi-reviewer coordination, main-verifier rules, deduplication, canonical reporting, and orchestration failure behavior.

### Gemini: frontend and visual-system owner

Gemini takes the visual implementation: converting the Stitch exports into Angular components, preserving the developer-tool visual language, building the review workflows, rendering live states and Markdown, and validating accessibility and responsive desktop behavior.

These assignments describe implementation responsibilities, not claims that only one provider can perform a task.

## Delivery plans

- **Codex stream:** `docs/superpowers/plans/2026-09-29-pr-review-orchestrator-codex.md`
- **Claude stream:** `docs/superpowers/plans/2026-09-29-pr-review-orchestrator-claude.md`
- **Gemini stream:** `docs/superpowers/plans/2026-09-29-pr-review-orchestrator-gemini.md`

## Phase and dependency graph

```text
Phase 0 — Contract gate
  Codex Task 1: repository, shared schemas, API routes, test harness
                       |
             signed contract commit
                       |
          +------------+------------+
          |            |            |
Phase 1  Codex 2-4   Claude 1-4   Gemini 1-5
          |            |            |
          +------------+------------+
                       |
Phase 2 — Integration gate
  Codex Task 5: merge, real wiring, security and E2E verification
                       |
  Claude: read-only orchestration review; Gemini: visual/accessibility review
                       |
  Codex Task 6: fix findings, Windows smoke test, release handoff
```

No Claude or Gemini implementation starts until Codex Task 1 is merged or its exact contract commit is available in their worktree.

## Branch and worktree policy

- Create three branches from the contract-gate commit:
  - `feat/pr-orchestrator-platform`
  - `feat/pr-orchestrator-engine`
  - `feat/pr-orchestrator-ui`
- Assign one managed worktree per branch.
- Codex owns `packages/contracts/**`, platform modules, migrations, root configuration, and final integration.
- Claude owns `apps/api/src/providers/**`, `apps/api/src/reviews/**`, and `apps/api/src/reports/**` after the contract gate.
- Gemini owns `apps/web/**` after the contract gate.
- Workers must not edit another stream's files. Contract changes require a message to Codex and a new contract-gate commit before consumers update.
- Merge order into the integration branch: platform, engine, UI.
- Resolve integration conflicts by preserving the owner stream and adapting only through shared contracts.

## Locked repository map

```text
apps/
  api/
    src/
      auth/                 # Codex
      azure-devops/         # Codex
      database/             # Codex
      providers/            # Claude
      reports/              # Claude
      reviews/              # Claude
      secrets/              # Codex
      settings/             # Codex
      standards/            # Codex
      workspace/            # Codex
  web/                      # Gemini
packages/
  contracts/                # Codex contract owner
tests/
  e2e/                      # Codex integration owner
  fixtures/fake-clis/       # Claude creates, Codex consumes
docs/superpowers/           # Design and plans
```

## Locked HTTP contract

The shared package defines request, response, and event Zod schemas for these routes:

```text
POST   /api/auth/setup
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/session
PUT    /api/auth/password

GET    /api/settings
PUT    /api/settings
GET    /api/settings/azure-auth
PUT    /api/settings/azure-pat
DELETE /api/settings/azure-pat
POST   /api/settings/azure-auth/test

GET    /api/standards
PUT    /api/standards
GET    /api/standards/content

GET    /api/providers
POST   /api/providers/refresh

POST   /api/pull-requests/validate

POST   /api/reviews
GET    /api/reviews/active
GET    /api/reviews
GET    /api/reviews/:reviewId
POST   /api/reviews/:reviewId/cancel
GET    /api/reviews/:reviewId/events
GET    /api/reviews/:reviewId/report.md
```

`GET /events` uses Server-Sent Events and emits `ReviewEventSchema` values. All other endpoints return JSON except the Markdown download route.

## Locked shared types

Codex Task 1 publishes these names from `@pr-orchestrator/contracts`:

```ts
type ProviderId = 'claude' | 'codex' | 'gemini';
type JobState =
  | 'queued' | 'preparing' | 'reviewing' | 'verifying'
  | 'rendering' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
type RunState = 'queued' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled';
type Severity = 'critical' | 'high' | 'medium' | 'low';

ReviewFindingSchema;
ReviewerResultSchema;
VerifierDecisionSchema;
VerifiedReportSchema;
ProviderStatusSchema;
SettingsSchema;
StandardsMetadataSchema;
PullRequestSummarySchema;
CreateReviewRequestSchema;
ReviewJobSchema;
ReviewEventSchema;
```

The schemas reject unknown fields at trust boundaries. TypeScript types are inferred from schemas and are not duplicated manually.

## Locked MVP defaults

- Local session lifetime: 12 hours; changing the password revokes all sessions.
- Minimum password length: 12 characters.
- Maximum parallel reviewer processes: 3.
- Reviewer timeout: 600 seconds per model; main-verifier timeout: 600 seconds.
- Sanitized process-output cap: 1 MiB for stdout and 1 MiB for stderr per run.
- Standards upload: UTF-8 `.md` or `.txt`, maximum 1 MiB.
- PR warning thresholds: more than 50 changed files or more than 1 MiB of diff text.
- PR hard limits: more than 200 changed files, more than 5 MiB of diff text, or an individual inspectable file above 1 MiB.
- Generated, binary, lock, and minified files are excluded from detailed inspection and disclosed in coverage metadata.
- Overall risk is derived from the highest verified finding (`critical`, `high`, `medium`, `low`) or `clean`; no numeric score is calculated.

## Integration gates

### Contract gate

- Root install succeeds with `npm ci`.
- `npm run test:contracts` passes.
- Angular and Nest compile against `@pr-orchestrator/contracts`.
- OpenAPI/API route names and SSE event names match this master plan.
- The contract commit hash is sent to Claude and Gemini before their work begins.

### Engine gate

- Fake Claude, Codex, and Gemini executables pass installation, auth, model, timeout, cancellation, and malformed-output tests.
- Orchestrator tests cover mixed reviewer outcomes and single-active-job enforcement.
- Report schema and Markdown renderer tests pass.

### UI gate

- Component tests cover every approved screen and warning state.
- The UI consumes only shared DTOs and a typed API client.
- No remote Stitch assets or CDN scripts remain.
- Accessibility checks report no serious or critical violations.

### Final gate

- `npm run lint`, `npm run test`, `npm run build`, and `npm run e2e` pass from the repository root.
- Security tests confirm PAT redaction and absence of Azure/repository write operations.
- A Windows smoke run detects the installed Claude, Codex, and Gemini CLIs without invoking a paid review.
- One opt-in manual smoke review may run only after the user selects models and understands it consumes provider usage.

## Cross-model handoff format

Every implementation handoff contains:

1. Branch and commit hash.
2. Tasks completed and tests run.
3. Exact shared contracts consumed or produced.
4. Known limitations and intentionally deferred scope.
5. No pasted secrets, provider tokens, or full model transcripts.

Review feedback is filed against the owning stream. The reviewer does not edit the owner's files unless ownership is explicitly transferred.

## Worker kickoff prompts

### Codex kickoff

```text
Read the approved design, master implementation plan, and Codex stream plan. Execute Codex Task 1 only using TDD. Establish the monorepo and shared-contract gate, commit it, run the contract/build commands, and report the commit hash and exact results. Do not start later tasks until Claude and Gemini have been given that contract commit.
```

### Claude kickoff

```text
Start from the contract-gate commit supplied by Codex. Read the approved design, master plan, and Claude stream plan. Implement only the Claude-owned provider, review, report, and fake-CLI paths using TDD and focused commits. Do not modify shared contracts or platform/UI files. At handoff, report the branch, commits, tests, contract assumptions, entity/migration requirements, and deferred behavior.
```

### Gemini kickoff

```text
Start from the contract-gate commit supplied by Codex. Read the approved design, master plan, Gemini stream plan, and the supplied Stitch screenshots/design notes. Implement only apps/web using Angular, TDD, and focused commits. Treat the Stitch HTML as visual reference only; remove unsupported actions and remote assets. At handoff, report the branch, commits, tests, accessibility results, contract assumptions, and deferred light/mobile behavior.
```

