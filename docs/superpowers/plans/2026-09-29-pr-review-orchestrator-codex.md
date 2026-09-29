# PR Review Orchestrator Codex Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the shared contracts, secure Windows-local platform services, Azure/Git workspace layer, and final integrated application.

**Architecture:** Codex owns the repository-wide contract gate and all platform modules outside the AI engine and Angular application. After Claude and Gemini complete their isolated streams, Codex merges them, wires real modules through the shared contracts, and runs the full security and end-to-end gates.

**Tech Stack:** Node.js 24.18+, npm 11 workspaces, TypeScript, Angular 22, NestJS 12, SQLite, TypeORM, `better-sqlite3`, Zod, Argon2id, `just-secrets`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-pr-review-orchestrator-design.md`

## Global Constraints

- Apply every constraint in the master plan and approved design.
- Do not implement provider adapters, orchestration logic, report rendering, or Angular screens before their owner streams merge.
- Root scripts are the canonical verification entry points.
- Persist no plaintext PAT and pass no PAT to provider processes.
- Use argument-array process spawning with `shell: false` for Git and Azure CLI calls.
- Only one active review is allowed by database constraint and orchestration logic.
- Use forward-only TypeORM migrations; never use schema synchronization in production.

## Review Focus

- Malformed Azure URL and encoded path traversal must fail before network or filesystem access; Task 4.
- Concurrent setup/login/session requests must not create multiple accounts or bypass authentication; Task 2.
- Replacing standards while a job is active must preserve its snapshot; Task 3 and final integration tests.
- Credential and authorization material must be redacted from all exceptions and child-process diagnostics; Tasks 3, 4, and 5.
- Interrupted jobs and leftover workspaces must recover idempotently at startup; Task 5.

---

### Task 1: Repository scaffold and contract gate

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `apps/api/**` from a strict NestJS 12 ESM scaffold
- Create: `apps/web/**` from an Angular 22 standalone/SCSS scaffold
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/settings.ts`
- Create: `packages/contracts/src/providers.ts`
- Create: `packages/contracts/src/pull-requests.ts`
- Create: `packages/contracts/src/findings.ts`
- Create: `packages/contracts/src/reviews.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: Approved design and master plan only.
- Produces: The `@pr-orchestrator/contracts` schemas and types named in the master plan; root scripts `lint`, `test`, `test:contracts`, `build`, and `e2e`.

- [ ] **Step 1: Create the npm workspace root**

Create a private root `package.json` with workspaces `apps/*` and `packages/*`, Node engine `>=24.15`, and placeholder root scripts that delegate to workspaces.

- [ ] **Step 2: Scaffold the two applications**

Run Angular CLI 22 with standalone routing and SCSS for `apps/web`, then Nest CLI 12 in strict ESM/Vitest mode for `apps/api`; both use npm and skip nested Git initialization.

- [ ] **Step 3: Create the contracts package and failing tests**

Write tests named `rejects_unknown_provider`, `rejects_finding_without_evidence`, `rejects_review_without_reviewer`, `rejects_duplicate_reviewer_selection`, `accepts_all_job_states`, and `rejects_event_with_unknown_payload`.

- [ ] **Step 4: Run the contracts test to verify failure**

Run: `npm run test:contracts`

Expected: FAIL because the exported Zod schemas do not exist.

- [ ] **Step 5: Implement the shared schemas**

Export the exact schema names and inferred types locked in the master plan. Use strict objects, UUID review IDs, normalized relative POSIX file paths, one required reviewer, and distinct `{provider, model}` pairs.

- [ ] **Step 6: Add contract-consumer compile probes**

Import `ProviderStatusSchema` from a Nest test and `ReviewJobSchema` from an Angular test so workspace resolution is proven on both sides.

- [ ] **Step 7: Run the contract gate**

Run: `npm run test:contracts && npm run build`

Expected: all contract tests PASS and both applications compile.

- [ ] **Step 8: Commit the contract gate**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore apps packages/contracts
git commit -m "build: establish orchestrator contracts"
```

Send this commit hash to Claude and Gemini before they begin.

### Task 2: Database, local account, sessions, and secret store

**Files:**
- Create: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/database/data-source.ts`
- Create: `apps/api/src/database/entities/user-account.entity.ts`
- Create: `apps/api/src/database/entities/session.entity.ts`
- Create: `apps/api/src/database/entities/credential-reference.entity.ts`
- Create: `apps/api/src/database/migrations/001-initial-platform.ts`
- Create: `apps/api/src/secrets/secret-store.ts`
- Create: `apps/api/src/secrets/windows-credential-store.ts`
- Create: `apps/api/src/secrets/fake-secret-store.ts`
- Create: `apps/api/src/auth/auth.service.ts`
- Create: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/session.guard.ts`
- Create: `apps/api/src/auth/auth.module.ts`
- Test: `apps/api/src/auth/auth.service.spec.ts`
- Test: `apps/api/src/auth/auth.controller.spec.ts`
- Test: `apps/api/src/secrets/windows-credential-store.spec.ts`

**Interfaces:**
- Consumes: Auth request/response schemas from Task 1.
- Produces: `SecretStore.get(key): Promise<string | null>`, `set(key, value): Promise<void>`, `delete(key): Promise<void>`; `AuthService.setup`, `login`, `logout`, `changePassword`, and `getSession` matching the locked routes.

```ts
interface SecretStore {
  get(key: 'azure-devops-pat'): Promise<string | null>;
  set(key: 'azure-devops-pat', value: string): Promise<void>;
  delete(key: 'azure-devops-pat'): Promise<void>;
}
```

- [ ] **Step 1: Write failing account and session tests**

Test first-account setup, rejection of a second account, Argon2id verification, invalid login, expired session, logout revocation, password change revocation, and simultaneous setup attempts producing exactly one account.

- [ ] **Step 2: Run the auth tests to verify failure**

Run: `npm --workspace apps/api test -- auth`

Expected: FAIL because the entities and services do not exist.

- [ ] **Step 3: Add the initial migration and database module**

Create `user_accounts`, `sessions`, and `credential_references` with unique single-user enforcement and indexed opaque session hashes. Configure WAL mode, foreign keys, and migrations; disable TypeORM `synchronize`.

- [ ] **Step 4: Implement the secret-store abstraction**

Wrap `just-secrets` behind `SecretStore`. Use service namespace `pr-review-orchestrator` and never return secret values from controllers or logs. Keep `FakeSecretStore` injectable for tests.

- [ ] **Step 5: Implement authentication**

Use Argon2id for password hashes, 32-byte random opaque session tokens, SHA-256 session-token persistence, HTTP-only `SameSite=Strict` cookies, and server-side expiry/revocation.

- [ ] **Step 6: Run auth and secret tests**

Run: `npm --workspace apps/api test -- auth secrets`

Expected: PASS, including the concurrent-setup and secret-non-disclosure assertions.

- [ ] **Step 7: Commit platform authentication**

```bash
git add apps/api/src/database apps/api/src/auth apps/api/src/secrets
git commit -m "feat: add secure local authentication"
```

### Task 3: Settings, standards versioning, and Azure authentication precedence

**Files:**
- Create: `apps/api/src/database/entities/app-setting.entity.ts`
- Create: `apps/api/src/database/entities/standards-version.entity.ts`
- Create: `apps/api/src/database/migrations/002-settings-standards.ts`
- Create: `apps/api/src/settings/settings.service.ts`
- Create: `apps/api/src/settings/settings.controller.ts`
- Create: `apps/api/src/settings/settings.module.ts`
- Create: `apps/api/src/standards/standards.service.ts`
- Create: `apps/api/src/standards/standards.controller.ts`
- Create: `apps/api/src/standards/standards.module.ts`
- Create: `apps/api/src/azure-devops/azure-auth.resolver.ts`
- Create: `apps/api/src/azure-devops/azure-cli-auth.client.ts`
- Test: `apps/api/src/settings/settings.service.spec.ts`
- Test: `apps/api/src/standards/standards.service.spec.ts`
- Test: `apps/api/src/azure-devops/azure-auth.resolver.spec.ts`

**Interfaces:**
- Consumes: `SettingsSchema`, `StandardsMetadataSchema`, and `SecretStore`.
- Produces: `SettingsService.get/update`; `StandardsService.replace/readActive/readContent/snapshotForReview`; `AzureAuthResolver.resolve(): Promise<AzureAuthMethod>` where `AzureAuthMethod` is PAT, Azure CLI, or unavailable.

```ts
type AzureAuthMethod =
  | { kind: 'pat'; credentialKey: 'azure-devops-pat' }
  | { kind: 'azure_cli'; executablePath: string }
  | { kind: 'unavailable'; reason: 'pat_missing_and_azure_cli_unavailable' };

interface StandardsSnapshot {
  versionId: string;
  filename: string;
  sha256: string;
  storagePath: string;
}
```

- [ ] **Step 1: Write failing settings and standards tests**

Test exact default values, settings validation, `.md`/text upload limits, filename traversal rejection, SHA-256 metadata, atomic replacement, immutable old versions, and snapshot stability across replacement.

- [ ] **Step 2: Write failing Azure-auth precedence tests**

Assert that a configured PAT always wins, Azure CLI is used only without a PAT, unavailable is returned when neither exists, and PAT values never appear in returned status or errors.

- [ ] **Step 3: Run the new tests to verify failure**

Run: `npm --workspace apps/api test -- settings standards azure-auth`

Expected: FAIL because the services and migration do not exist.

- [ ] **Step 4: Implement settings and standards storage**

Store non-secret settings in SQLite. Store standards contents under the application data directory using hash-addressed filenames and write-then-rename replacement. Keep every referenced historical version.

- [ ] **Step 5: Implement PAT and Azure CLI status**

Store only the PAT credential reference in SQLite. Detect `az` by absolute path, check the Azure DevOps extension and authenticated account without mutating configuration, and return sanitized status.

- [ ] **Step 6: Run settings, standards, and auth-precedence tests**

Run: `npm --workspace apps/api test -- settings standards azure-auth`

Expected: PASS with no plaintext PAT in snapshots.

- [ ] **Step 7: Commit configuration services**

```bash
git add apps/api/src/database apps/api/src/settings apps/api/src/standards apps/api/src/azure-devops/azure-auth.resolver.ts apps/api/src/azure-devops/azure-cli-auth.client.ts
git commit -m "feat: add settings and standards management"
```

### Task 4: Azure PR validation and isolated Git workspace

**Files:**
- Create: `apps/api/src/azure-devops/azure-pr-url.parser.ts`
- Create: `apps/api/src/azure-devops/azure-rest.client.ts`
- Create: `apps/api/src/azure-devops/azure-devops.service.ts`
- Create: `apps/api/src/azure-devops/azure-devops.controller.ts`
- Create: `apps/api/src/azure-devops/azure-devops.module.ts`
- Create: `apps/api/src/workspace/git-process.service.ts`
- Create: `apps/api/src/workspace/workspace.service.ts`
- Create: `apps/api/src/workspace/technology-detector.service.ts`
- Create: `apps/api/src/workspace/scope-policy.service.ts`
- Create: `apps/api/src/workspace/workspace-cleanup.service.ts`
- Create: `apps/api/src/workspace/workspace.module.ts`
- Test: `apps/api/src/azure-devops/azure-pr-url.parser.spec.ts`
- Test: `apps/api/src/azure-devops/azure-devops.service.spec.ts`
- Test: `apps/api/src/workspace/workspace.service.spec.ts`
- Test: `apps/api/src/workspace/technology-detector.service.spec.ts`
- Test: `apps/api/src/workspace/scope-policy.service.spec.ts`

**Interfaces:**
- Consumes: `PullRequestSummarySchema`, `AzureAuthResolver`, and settings/standards services.
- Produces: `AzureDevOpsService.validatePullRequest(url): Promise<PullRequestSummary>`; `WorkspaceService.prepare(input): Promise<PreparedWorkspace>`; `WorkspaceCleanupService.cleanup(workspaceId): Promise<void>`.

```ts
interface PreparedWorkspace {
  workspaceId: string;
  rootPath: string;
  sourceCommit: string;
  targetCommit: string;
  diffPath: string;
  metadataPath: string;
  technologyManifestPath: string;
  standardsPath: string | null;
  exclusions: Array<{ path: string; reason: string }>;
  warnings: string[];
}
```

- [ ] **Step 1: Write failing URL and PR-client tests**

Cover valid `dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}` URLs, encoded traversal, alternate hosts, missing identifiers, PAT redaction, Azure CLI fallback, 401/403/404 mapping, and response-schema validation.

- [ ] **Step 2: Write failing workspace tests**

Use a temporary Git fixture to assert source/target fetch, unified diff creation, absence of credential-bearing remotes, disabled push URL, normalized context files, cleanup idempotence, and no writes outside the workspace root.

- [ ] **Step 3: Write failing detection and scope tests**

Cover Angular/package manifests, language project files, binary/minified/lockfile exclusions, warning thresholds, hard rejection thresholds, and excluded-file coverage metadata.

- [ ] **Step 4: Run the Azure and workspace tests to verify failure**

Run: `npm --workspace apps/api test -- azure-devops workspace`

Expected: FAIL because the clients and workspace services do not exist.

- [ ] **Step 5: Implement PR validation**

Use read-only Azure REST calls when PAT auth is selected and `az repos pr show`/read-only Azure CLI calls for the CLI method. Normalize both into `PullRequestSummarySchema` and redact diagnostics.

- [ ] **Step 6: Implement workspace preparation**

Spawn Git by absolute path with `shell: false`, inject authentication only for fetch, check out the source revision, write context files atomically, remove fetch credentials, set a disabled push URL, and return only normalized paths inside the workspace root.

- [ ] **Step 7: Implement detection, limits, and cleanup**

Read manifests without executing them, calculate scope thresholds, disclose exclusions, and delete only resolved descendants of the configured workspace root.

- [ ] **Step 8: Run the Azure/workspace suite**

Run: `npm --workspace apps/api test -- azure-devops workspace`

Expected: PASS, including malicious URL/path and PAT-redaction cases.

- [ ] **Step 9: Commit Azure and workspace support**

```bash
git add apps/api/src/azure-devops apps/api/src/workspace
git commit -m "feat: prepare Azure PR review workspaces"
```

### Task 5: Merge streams and wire the complete application

**Files:**
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/web/src/app/app.config.ts`
- Create: `apps/api/src/database/migrations/003-review-engine.ts`
- Create: `tests/e2e/global.setup.ts`
- Create: `tests/e2e/auth-settings.spec.ts`
- Create: `tests/e2e/review-happy-path.spec.ts`
- Create: `tests/e2e/review-failures.spec.ts`
- Create: `tests/e2e/security.spec.ts`
- Create: `playwright.config.ts`
- Modify: root `package.json`

**Interfaces:**
- Consumes: Claude's provider/review/report modules and fake CLIs; Gemini's Angular application; all shared contracts.
- Produces: One runnable application with root verification commands and production localhost configuration.

- [ ] **Step 1: Merge owner streams in order**

Merge platform, then Claude engine, then Gemini UI into the integration branch. Reject cross-owner edits and resolve only through shared interfaces.

- [ ] **Step 2: Write failing full-stack tests**

Cover first-run setup, login, PAT replacement, standards replacement, provider refresh, PR validation, one successful review, partial reviewer failure, all-reviewer failure, verifier failure, cancellation, one-active-job race, history retrieval, Markdown download, and immutable standards snapshot.

- [ ] **Step 3: Write failing security tests**

Scan process arguments, captured logs, SQLite, generated reports, and prompts for the test PAT; assert zero matches. Assert the API surface has no comment, vote, approval, commit, push, or patch endpoint.

- [ ] **Step 4: Run E2E tests to verify failure**

Run: `npm run e2e`

Expected: FAIL at missing module wiring or migrations.

- [ ] **Step 5: Wire modules and migrations**

Register all Nest modules, apply migrations before serving, bind `127.0.0.1`, serve the Angular build from the same origin, configure secure session behavior, and connect the Angular typed client to the live API/SSE routes.

- [ ] **Step 6: Make startup recovery explicit**

At API bootstrap, mark interrupted jobs failed, terminate known child process trees, and call idempotent cleanup before accepting a new job.

- [ ] **Step 7: Run the full automated gate**

Run: `npm run lint && npm run test && npm run build && npm run e2e`

Expected: PASS with no skipped security or orchestration tests.

- [ ] **Step 8: Commit integrated application**

```bash
git add apps packages tests package.json package-lock.json playwright.config.ts
git commit -m "feat: integrate PR review orchestrator"
```

### Task 6: Cross-model review fixes and Windows release verification

**Files:**
- Modify: only files required by accepted Claude/Gemini review findings
- Create: `scripts/smoke-windows.ps1`
- Create: `docs/runbook.md`
- Test: `tests/e2e/windows-smoke.spec.ts`

**Interfaces:**
- Consumes: Claude's read-only orchestration/security review and Gemini's read-only visual/accessibility review.
- Produces: Verified Windows-local MVP and operating runbook.

- [ ] **Step 1: Request read-only owner reviews**

Ask Claude to review orchestration, prompt safety, failure semantics, and secret boundaries. Ask Gemini to review Stitch fidelity, state coverage, desktop responsiveness, and accessibility. Neither reviewer edits code.

- [ ] **Step 2: Record and validate findings**

For each finding, reproduce it with a failing automated test or reject it with evidence. Do not implement unverified review claims.

- [ ] **Step 3: Implement accepted fixes**

Change only the owning files needed to make the new regression tests pass, coordinating ownership when a fix crosses streams.

- [ ] **Step 4: Add the Windows smoke script**

The script checks Node/npm/Git versions, database migrations, localhost binding, writable app-data directories, and detection of `claude`, `codex`, and `gemini`. It must not launch a paid model invocation.

- [ ] **Step 5: Run final verification**

Run: `npm run lint && npm run test && npm run build && npm run e2e && powershell -File scripts/smoke-windows.ps1`

Expected: every command exits 0; smoke output reports provider installation status without starting a review.

- [ ] **Step 6: Commit release hardening**

```bash
git add apps packages tests scripts docs/runbook.md
git commit -m "test: harden Windows orchestrator release"
```

