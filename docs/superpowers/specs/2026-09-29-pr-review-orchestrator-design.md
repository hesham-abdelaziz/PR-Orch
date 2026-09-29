# PR Review Orchestrator Design

**Date:** 2026-09-29  
**Status:** Approved conversational design; awaiting written-spec review  
**Target:** Windows localhost MVP

## 1. Purpose

PR Review Orchestrator is a single-user, localhost-only web application for reviewing Azure DevOps pull requests with locally installed Claude, Codex, and Gemini CLI tools.

For each review, the user selects exactly one main verifier model and one or more reviewer models. Reviewer models inspect the pull request independently and in parallel. The main verifier then checks their claims against the code and standards, removes unsupported findings, merges duplicates, calibrates severity, and produces the final report.

The system is strictly read-only with respect to Azure DevOps and the reviewed repository. It does not publish PR comments, approve or reject a PR, create commits, push branches, or apply suggested patches.

## 2. Goals

- Accept an Azure DevOps PR URL and retrieve its metadata and repository content.
- Use existing local authentication sessions for Claude, Codex, and Gemini CLIs.
- Detect available providers and models where their CLIs support discovery.
- Require one main verifier and allow multiple reviewer models.
- Run reviewers concurrently inside a single active PR review job.
- Apply an uploaded standards file when present.
- Warn clearly when standards are missing and fall back to detected framework and library guidance.
- Continue with successful reviewers when another reviewer fails or times out.
- Require the main model to validate all findings before displaying them.
- Present and persist an immutable Markdown report and structured audit record.
- Minimize token usage by allowing agents to inspect a local checkout instead of embedding the repository in prompts.

## 3. Non-goals for the MVP

- Multiple application users or remote network access.
- Multiple PR review jobs running simultaneously.
- Azure DevOps comments, votes, approvals, commits, or pushes.
- Applying or generating repository patches through the UI.
- Tests, builds, linters, dependency installation, or application code execution.
- Cloud API-key integrations managed by the dashboard.
- Mobile layouts, light theme, PDF report export, or a desktop wrapper.
- Deterministic replay, re-evaluation of an old job, or numeric consensus scoring.
- Guaranteed air-gapped or zero-egress execution; provider CLIs require network access.

## 4. Technology and deployment

The application is a modular monolith composed of:

- **Angular frontend** for all user-facing workflows.
- **NestJS backend** for authentication, settings, Azure DevOps access, workspace preparation, provider execution, orchestration, and report persistence.
- **SQLite** for structured local state.
- **Local filesystem storage** for standards snapshots, reports, sanitized logs, and temporary workspaces.
- **Windows Credential Manager** for the optional Azure DevOps PAT.

The production build serves Angular and the NestJS API from one local origin. The backend binds only to `127.0.0.1`. No external server deployment is part of the MVP.

The project will be organized as one repository. Shared TypeScript packages will define API DTOs, job states, finding schemas, and provider contracts.

## 5. Major modules

### 5.1 AuthModule

Creates the single local account on first launch, verifies the username and password, manages the local session, and supports password changes and sign-out.

### 5.2 SettingsModule

Stores non-secret configuration such as reviewer timeout, concurrency, large-PR thresholds, excluded file patterns, workspace root, and default model selections. It refers to secrets only through credential references.

### 5.3 StandardsModule

Uploads, validates, hashes, stores, previews, and replaces the standards file. A review snapshots the selected standards version so replacing the current file never changes historical reports.

### 5.4 AzureDevOpsModule

Parses supported Azure DevOps PR URLs, retrieves PR metadata through read-only APIs, resolves source and target revisions, validates access, and supplies authenticated fetch configuration to the workspace module. When a PAT is configured, it is always used. Otherwise, the module may use an existing authenticated Azure CLI session. It exposes no write endpoints.

### 5.5 WorkspaceModule

Creates a unique temporary checkout, fetches source and target revisions, generates the PR diff and context manifest, removes usable push configuration and credentials, detects project technology, applies exclusions, and cleans the workspace.

### 5.6 ProviderModule

Owns provider adapters for Claude, Codex, and Gemini. Each adapter isolates CLI-specific command construction, installation detection, authentication checks, model discovery, read-only execution flags, process cancellation, and output parsing.

### 5.7 ReviewOrchestratorModule

Enforces the one-active-job rule, advances the job state machine, starts reviewer processes within the concurrency limit, handles failures and timeouts, normalizes findings, runs the main verifier, and coordinates cancellation and recovery.

### 5.8 ReportModule

Validates the main verifier output, creates the canonical structured report, renders sanitized Markdown, saves audit metadata, and supports Markdown copy and download.

### 5.9 HistoryModule

Lists and filters immutable past jobs and returns saved reports. It does not rerun or mutate completed jobs.

## 6. Provider adapter contract

All providers implement the same conceptual interface:

```ts
interface ProviderAdapter {
  detectInstallation(): Promise<ProviderInstallation>;
  checkAuthentication(): Promise<AuthenticationState>;
  listModels(): Promise<ModelCatalog>;
  runReview(request: ProviderRunRequest): Promise<ProviderRunResult>;
  cancel(runId: string): Promise<void>;
}
```

`ModelCatalog` records whether the list is dynamically discovered or maintained by the adapter and validated at execution time. A model that cannot be validated is unavailable in the UI.

Provider commands are executed by absolute path with argument arrays and `shell: false`. Prompts are supplied through standard input or protected temporary files. Neither user text nor model identifiers are interpolated into a shell command.

Each adapter must use the strongest CLI-supported read-only or no-edit mode. Provider capability tests determine the exact flags during implementation. If a provider cannot satisfy the read-only execution contract, it is disabled with a diagnostic message rather than run unsafely.

## 7. Review job state machine

Only one job may be active. Its state follows this model:

```text
queued -> preparing -> reviewing -> verifying -> rendering -> completed
                                                      \-> failed
any active state -> cancelling -> cancelled
```

The backend owns state transitions. The UI renders explicit state events and never infers state from raw process output.

On startup, a job left in an active state is marked interrupted and then failed with a recovery reason. Its process and workspace cleanup is retried. Jobs are not resumed automatically.

## 8. End-to-end review flow

### 8.1 Validate the PR

The user submits an Azure DevOps PR URL. The backend parses it, resolves the configured Azure authentication method, retrieves PR metadata, checks repository access, and returns the repository, PR number, title, author, branches, revisions, changed files, and diff statistics.

Azure authentication follows a fixed precedence: a saved PAT is used whenever present; otherwise, an existing authenticated Azure CLI plus the Azure DevOps extension may be used. If neither is available, validation stops with setup guidance. The local application account does not authenticate the user to Azure DevOps.

Malformed URLs, authentication failures, missing PRs, and access failures stop before job creation and produce actionable messages.

### 8.2 Prepare the workspace

The workspace module creates a unique directory within the configured application data location. It fetches only the required source and target revisions. Authentication is supplied without embedding the PAT in a URL, command log, or persisted Git configuration.

After fetching, the workspace contains:

- The source revision checkout.
- The target and source commit identifiers.
- A unified PR diff.
- PR metadata as structured JSON.
- A detected-technology manifest.
- A standards snapshot or fallback-guidance notice.
- Exclusion and coverage metadata.

Push targets and Azure credentials are removed before any AI subprocess starts. The PAT is never included in a provider environment.

### 8.3 Detect technologies and review scope

The backend reads manifests and configuration files such as `package.json`, `angular.json`, lockfiles, language project files, and equivalent framework metadata. It records detected languages, frameworks, libraries, and versions without installing dependencies or executing repository code.

Generated files, lockfiles, minified assets, binary files, oversized files, and configured glob exclusions are omitted from detailed inspection. The exclusions remain visible in the final coverage metadata.

### 8.4 Resolve guidance

When a standards file exists, the job snapshots its version, SHA-256 hash, filename, and contents. Reviewer and verifier prompts identify it as the project-specific authority.

When it is missing, the UI and report show an amber warning. Prompts instruct providers to use detected framework and library best practices, consulting their locally configured documentation or MCP capabilities when available. Version-specific claims must identify their source. The main verifier rejects documentation claims that cannot be supported reliably.

Additional per-run instructions supplement the protected core prompt. They cannot override read-only behavior, finding evidence requirements, output schemas, or verification rules.

### 8.5 Run reviewer models

Selected reviewer models run independently and concurrently, capped by the configured concurrency value. Each receives the same concise task, local context paths, review scope, standards snapshot, and additional instructions.

Reviewers inspect changed files and relevant surrounding code. They do not receive full transcripts from other reviewers. They return findings using the reviewer output schema.

Each subprocess has a timeout and bounded sanitized logs. A crash or timeout does not stop other reviewers. Malformed output receives one schema-correction attempt. A second malformed result marks that reviewer failed.

If every reviewer fails, the job fails and the main verifier is not started. If at least one succeeds, the job continues with a partial-results warning.

### 8.6 Normalize findings

The backend validates reviewer output and assigns stable candidate identifiers. Every candidate includes:

- Title.
- Severity: critical, high, medium, or low.
- File path.
- Line range or precise code location.
- Concrete evidence.
- Impact.
- Suggested fix.
- Standards or best-practice reference when applicable.
- Originating provider and model.

Unparseable text is never silently promoted to a finding.

### 8.7 Run the main verifier

The main verifier receives normalized candidate findings, job warnings, coverage metadata, and access to the same read-only checkout. It inspects the referenced code and any necessary dependencies.

For each candidate, it must accept, reject, or merge the claim with direct code evidence. It recalibrates severity and authors the canonical wording. It may introduce a new finding only when it supplies direct code evidence and the finding is within the PR review scope.

The verifier returns structured JSON. It receives one schema-correction attempt if necessary. If verification still fails, the job fails. Reviewer output remains available for diagnostics but is not shown as a verified final report.

### 8.8 Render and persist

The report module stores the structured result and renders Markdown. Each displayed finding contains:

- Bug title.
- Severity.
- File and line or code location.
- Explanation and concrete evidence.
- Impact.
- Suggested fix.
- Reviewer origins.
- Main-verifier decision.

The report header records PR metadata, selected models, duration, reviewer statuses, standards source and hash, warnings, exclusions, and coverage limitations. Rejected and merged claim counts are visible; detailed rejected claims appear only in a collapsed audit section.

### 8.9 Clean up

The backend terminates remaining child processes and removes the temporary workspace. Cleanup failures are recorded, shown as warnings, and retried on next startup. Reports and sanitized bounded logs remain.

## 9. Context and token control

The application does not place the full repository in prompts. Providers receive concise instructions and local paths to the checkout, diff, metadata, detected-technology manifest, and standards snapshot. They decide which relevant files to read within the allowed scope.

The main verifier receives normalized findings rather than reviewer transcripts. It starts with referenced paths and inspects only enough surrounding code to verify each claim.

The dashboard shows warning thresholds for changed file count and diff size. Configurable hard limits cover changed files, diff bytes, and individual file size. A PR above a hard limit is rejected explicitly rather than silently truncated. A PR between warning and hard limits may continue with a coverage warning.

## 10. Data model

The SQLite schema contains these principal entities:

- `user_accounts`: username, Argon2id hash, and timestamps.
- `sessions`: opaque session identifiers, expiry, and revocation state.
- `app_settings`: non-secret configuration and review defaults.
- `credential_references`: Windows Credential Manager target references.
- `standards_versions`: file metadata, hash, storage path, and active flag.
- `provider_snapshots`: installation path, version, auth state, models, discovery mode, and refresh time.
- `review_jobs`: PR metadata, job state, timing, standards version, selected models, warnings, exclusions, and failure details.
- `reviewer_runs`: provider, model, state, timing, sanitized logs, and raw normalized result.
- `candidate_findings`: normalized reviewer findings and origin data.
- `final_findings`: canonical verified findings, verdicts, and merged origins.
- `reports`: canonical structured JSON and rendered Markdown.

Historical review rows point to the exact standards version used. Replacing the active standards file never mutates an old review.

## 11. Security design

- The server binds only to `127.0.0.1`.
- Sessions use HTTP-only, secure-when-applicable, `SameSite=Strict` cookies and server-side revocation.
- Passwords use Argon2id with unique salts.
- The optional PAT is stored in Windows Credential Manager, not SQLite or configuration files.
- Logs redact PAT values, authorization headers, and credential-bearing URLs.
- Provider tokens remain under each CLI's existing authentication system.
- AI subprocesses never receive the Azure PAT.
- Executables must match detected absolute paths; arbitrary command paths are rejected.
- Child processes use argument arrays with `shell: false`.
- Uploaded standards files are size-limited text and are never executed.
- Uploaded filenames and model-provided paths are normalized to prevent traversal.
- Markdown rendering disables raw HTML and sanitizes links.
- The backend includes no Azure write client and no commit, push, patch, or approval service.
- Temporary checkout Git configuration contains no usable push target or credentials before model execution.
- Provider adapters must prove read-only mode availability before becoming selectable.

The product promises read-only repository behavior. It does not claim that the machine, network, or third-party provider CLIs are isolated from all egress.

## 12. User interface

The implementation uses the exported Stitch designs as a visual reference, not as production code. The production frontend uses Angular components and local assets; it does not ship Stitch's Tailwind CDN, remote logo, sample data, or inline scripts.

The visual design retains the compact dark developer-tool aesthetic, fixed navigation, provider colors, status chips, monospace technical metadata, and persistent read-only indicator. The MVP supports desktop widths of 1024 pixels and wider and ships only the dark theme.

### 12.1 Sign in

First launch creates the single account. Subsequent visits display username and password fields. Successful authentication opens New Review.

### 12.2 New Review

The page contains PR URL validation, the validated PR summary, exactly one main verifier selector, one or more reviewer selectors, standards status, optional additional instructions, and a start action. Duplicate provider/model combinations are blocked.

If another review is active, starting is disabled and the page links to that job. A missing standards file produces a visible fallback warning.

### 12.3 Active Review

The page renders these stages: validate, checkout, detect, standards, reviewers, verify, report, and cleanup. Each reviewer has an explicit state and a collapsed sanitized log. The single Cancel Review action terminates the entire job. The Stitch pause-and-inspect action is not included.

### 12.4 Final Report

The rendered Markdown report is primary. Header metadata describes the PR, models, standards, duration, coverage, and warnings. The user can copy or download Markdown and start another review.

There are no patch, PDF, Azure submission, approval, commit, or push actions. Empty states support no verified findings and all claims rejected.

### 12.5 Review History

History supports search and filters by repository, provider, job status, risk level, and date. Reports are immutable. Statuses are completed, completed with warnings, failed, and cancelled. Replay and re-evaluation are excluded from the MVP.

### 12.6 Standards

The page shows the active filename, size, SHA-256 hash, upload time, content preview, and replace action. It shows the fallback explanation when no file exists.

### 12.7 Settings

Settings cover the account, optional Azure PAT, detected Azure CLI authentication, provider installation and authentication status, model refresh, default model choices, timeouts, concurrency, limits, exclusions, Windows workspace location, and cleanup behavior.

## 13. Error handling

- Input and preparation errors stop before reviewer execution.
- Reviewer failure is non-fatal if another reviewer succeeds.
- All-reviewer failure prevents verification.
- Main-verifier failure prevents a verified report.
- Cancellation kills the child-process tree and records a cancelled job.
- Sanitized logs are capped to prevent unbounded database or memory growth.
- Workspace cleanup is idempotent and retryable.
- UI errors are concise, actionable, and preserve valid form selections.

## 14. Testing strategy

Normal automated tests use deterministic fake provider executables and mock Azure DevOps responses. They do not call paid models.

### 14.1 Angular unit tests

Cover form validation, model selection, standards warnings, pipeline rendering, partial failures, empty reports, Markdown rendering, and sanitization.

### 14.2 NestJS unit tests

Cover URL parsing, provider command construction, discovery parsing, secret redaction, state transitions, cancellation, timeouts, finding schemas, report generation, thresholds, and exclusions.

### 14.3 Integration tests

Cover SQLite migrations, a fake credential store, Azure authentication precedence, mock Azure APIs and CLI responses, temporary Git repositories, fake provider processes, mixed reviewer outcomes, verifier normalization, restart recovery, and cleanup.

### 14.4 End-to-end tests

Cover first-run account creation, sign-in, PAT configuration, standards replacement, provider detection, model selection, PR validation, the full review flow, report copy/download, history retrieval, cancellation, and one-active-job enforcement.

### 14.5 Security regression tests

Assert that the PAT never appears in logs, prompts, arguments, reports, or SQLite; raw HTML is not executed; path traversal is rejected; arbitrary executables are rejected; and no application route or service can write to Azure or the repository.

## 15. Acceptance criteria

The MVP is accepted when:

1. It starts on Windows and is reachable only through localhost.
2. The single user can authenticate and can access Azure DevOps through a safely stored optional PAT or an existing authenticated Azure CLI session.
3. It detects supported Claude, Codex, and Gemini CLI installations and usable models.
4. The user can choose one main verifier and multiple reviewer models.
5. One PR review job runs at a time, with reviewer models executing concurrently.
6. Partial reviewer failures produce a completed report with visible warnings.
7. The main model verifies every displayed finding against code evidence.
8. Every finding contains title, severity, location, evidence, impact, and suggested fix.
9. Every report records the standards version or fallback-guidance warning.
10. Historical reports remain unchanged after standards replacement.
11. Large and excluded review scopes are disclosed explicitly.
12. The system performs no Azure or repository write action.
13. Workspaces are cleaned after completion, failure, cancellation, and recovery.
14. Automated unit, integration, end-to-end, and security tests pass.

## 16. Stitch design corrections

The exported screens remain the visual baseline with these mandatory changes:

- Add the missing sign-in and first-run account screens.
- Remove Apply Suggestion, DevOps approval, comment, commit, push, and patch actions.
- Remove PDF export, replay, re-evaluation, and fabricated numeric consensus or risk scoring.
- Replace Linux paths with Windows-aware paths.
- Represent existing CLI sessions rather than assuming dashboard-managed API keys.
- Add missing-standards and framework-guidance fallback states.
- Remove unsupported AST-verification claims unless a future feature implements real AST parsing.
- Replace air-gapped and zero-egress claims with accurate read-only wording.
- Use explicit provider and model controls backed by adapter availability.
- Preserve the active pipeline, report, history, settings, and dark visual system with reduced information density.

