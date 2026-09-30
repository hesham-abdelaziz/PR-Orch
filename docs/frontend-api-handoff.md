# Runnable backend / Gemini API handoff

Date: 2026-09-30, Africa/Cairo. Integration branch: `feat/pr-orchestrator-integration`.
Worktree: `C:/Users/EGDev06/.codex/worktrees/platform-integration/x20`.

The local backend is wired to the existing durable platform and unchanged engine. Gemini's UI checkout was inspected read-only and has not been modified or merged. The served web build is still the integration branch's Angular scaffold. Browser acceptance is pending UI integration.

## Run on Windows

Use Node 24.18+ and Git for Windows on PATH. From PowerShell:

```powershell
Set-Location 'C:/Users/EGDev06/.codex/worktrees/platform-integration/x20'
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:3000`. `PORT` may select another port (1–65535); the listener always binds `127.0.0.1`. Default persistent storage is `%LOCALAPPDATA%/pr-review-orchestrator`, containing `orchestrator.sqlite`, immutable `standards/` files, and temporary `workspaces/`. An absolute `PR_ORCHESTRATOR_DATA_ROOT` overrides that directory. Do not point it at another application's directory. The workspace root setting remains confined to this application's `workspaces/`.

Migrations finish before HTTP is served. An OS-held lease prevents another instance using the same canonical data root, even with a different port. Startup fails interrupted jobs and retries recorded cleanup, then sweeps orphan `job-*` workspaces through the existing confined cleanup service. Shutdown cancels reviews and provider trees, waits for completion, closes SQLite, and releases the lease. Windows is the deployment target; the lease also supports Linux abstract sockets.

The compiled Angular build is served from `apps/web/dist/web/browser` with SPA navigation fallback. Keep API and UI at one origin. Direct cross-origin fetch is rejected. A development proxy must forward cookies/SSE and present a backend Host and matching Origin; changing Host alone is insufficient. Run browser acceptance against the same-origin production build.

## Authentication and HTTP behavior

All routes except `GET /api/auth/session`, `POST /api/auth/setup`, and `POST /api/auth/login` require the opaque session cookie. Host must be the local host and actual server port; supplied Origin must match it exactly. Foreign hosts/origins are rejected before authentication. No permissive CORS is enabled and forwarded headers are not trusted.

Cookie: `pr_session`, HttpOnly, SameSite=Strict, Path=/api, 12-hour expiry, no Domain. Secure is absent for the configured loopback HTTP service. No bearer/session token is returned in JSON. Use ordinary same-origin fetch/EventSource and do not store the cookie in JavaScript. JSON API responses carry `Cache-Control: no-store`; content security and framing headers are applied centrally.

| Method / path | Body | Successful response |
| --- | --- | --- |
| POST `/api/auth/setup` | `SetupAccountRequestSchema`: `{username,password}` | 201 `AuthSessionSchema`, sets cookie; second setup 409 |
| POST `/api/auth/login` | `LoginRequestSchema`: `{username,password}` | 200 `AuthSessionSchema`, sets cookie; invalid credentials 401 |
| GET `/api/auth/session` | — | 200 `AuthSessionSchema`: unauthenticated `{authenticated:false,setupRequired:boolean}`; authenticated also has `username,expiresAt` |
| POST `/api/auth/logout` | — | 204 empty body; revokes session and clears cookie |
| PUT `/api/auth/password` | `ChangePasswordRequestSchema`: `{currentPassword,newPassword}` | 204 empty body; revokes **all** sessions and clears cookie; sign in again |
| GET `/api/settings` | — | 200 `SettingsSchema` |
| PUT `/api/settings` | `UpdateSettingsRequestSchema` (partial settings) | 200 full `SettingsSchema` |
| GET `/api/settings/azure-auth` | — | 200 `AzureAuthStatusSchema` |
| PUT `/api/settings/azure-pat` | `{pat:string}` | 200 `AzureAuthStatusSchema`, never returns PAT or token |
| DELETE `/api/settings/azure-pat` | — | 200 `AzureAuthStatusSchema` |
| POST `/api/settings/azure-auth/test` | — | 201 `{ok:boolean,message:string}`; availability check, **not proof of repository access** |
| GET `/api/standards` | — | 200 `StandardsMetadataSchema` or actual JSON `null` |
| PUT `/api/standards` | `{filename,content}` JSON | 200 `StandardsMetadataSchema` |
| GET `/api/standards/content` | — | 200 `{content:string}`; empty string when absent |
| GET `/api/providers` | — | 200 `ProviderStatusSchema[]` |
| POST `/api/providers/refresh` | — | 201 `ProviderStatusSchema[]` |
| POST `/api/pull-requests/validate` | `ValidatePullRequestRequestSchema`: `{url}` | 200 `PullRequestSummarySchema` |

Passwords require 12–256 characters. Setup creates exactly one account. Settings are validated after merging the partial update with current values; `limits` must be a complete valid limits object when replaced. Standards accept UTF-8 `.md`/`.txt`, at most 1 MiB and within a smaller configured `standardsMaxBytes`. The current contract's 1 MiB standards metadata ceiling remains authoritative even when settings allow a larger maximum. Filenames cannot traverse directories. Every replacement creates a new version; active reviews retain their original snapshot.

When `GET /api/standards` returns `null`, Gemini must display the missing-standards warning and permit reviews. Workspace/engine warnings explain that detected framework/library best practices apply. Provider authentication `unknown_until_run` is supported, distinct from authenticated; maintained/configured catalogs are not guaranteed dynamic discoveries.

## Azure authentication and metadata

Only canonical `https://dev.azure.com/{organization}/{project}/_git/{repository}/pullrequest/{positiveId}` URLs are accepted. Query/fragment/userinfo, foreign hosts, traversal, double separators, encoded slash/backslash/dot traversal and excessive identifiers are rejected before credentials/network access.

A saved PAT always wins. An invalid PAT produces an error and never silently switches to CLI authentication. Save only a Code read PAT; it lives in Windows Credential Manager under `pr-review-orchestrator / azure-devops-pat`, not SQLite. Deleting it permits CLI fallback.

Without a PAT, the backend reads an existing Azure CLI Entra session using `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken --output tsv`. This is the documented Azure DevOps resource. It uses only Azure CLI core authentication and REST GET requests, so the DevOps extension is unnecessary. On Windows the official MSI's `az.cmd` resolves to its adjacent Python executable plus `-I -m azure.cli`, allowing `shell:false`. No login, extension installation or Azure CLI configuration mutation is triggered. If absent/unauthenticated, configure a PAT or run `az login` separately outside the dashboard.

Read-only REST obtains PR metadata, iterations and paginated latest-iteration changes. Response identities, branches, revisions, dates, pagination and size/time limits are checked. The latest iteration's source must match the PR source; its target snapshot may differ from the target at the latest merge evaluation. The returned source/target commit pair is fetched explicitly.

PAT Basic headers and CLI bearer headers are supplied only in REST requests and ephemeral Git fetch environment configuration. Git redirects and credential helpers are disabled, prompts are disabled, no credential enters argv/remotes/persisted configuration, and provider environments receive no acquired Azure credential. Raw and encoded rotated credentials remain registered for redaction until shutdown.

**Compatibility decision: line-count fields.** Azure PR iteration-change REST does not provide line additions/deletions. Existing `PullRequestSummarySchema` requires nonnullable integers, so this backend preserves the schema and returns `additions:0,deletions:0` as **unavailable placeholders**, not measured zero lines. Gemini must hide these counts or label them unavailable. `changedFiles` counts distinct changes in the latest iteration relative to its common base; workspace preparation independently recomputes the actual fetched diff and enforces hard limits. An accurate pre-review line-count UI requires a later explicit contract/capability decision; do not display fabricated statistics.

Errors: invalid request/URL 400; missing Azure auth or upstream 401 maps to 422 (distinct from local-session 401); Azure access denied 403; missing PR/repository 404; invalid/upstream/network response 502. Diagnostics are bounded and sanitized. General platform failures return a generic 500 without native/SQL/credential diagnostics. Structured errors generally contain `message` and may contain `statusCode`, `error`, `issues[]`, or `activeReviewId`; preserve selections and display `message`.

Sources for the CLI/iteration decisions: [Entra token authentication](https://learn.microsoft.com/en-us/azure/devops/cli/entra-tokens?view=azure-devops), [PR iteration contract](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iterations/list?view=azure-devops-rest-7.1), [PR GET contract](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-request?view=azure-devops-rest-7.1).

## Review, history, report and SSE

| Method / path | Response |
| --- | --- |
| POST `/api/reviews` | 201 `ReviewJobSchema`; body `CreateReviewRequestSchema`: `{pullRequestUrl,main:{provider,model},reviewers:[{provider,model}],additionalInstructions?}` |
| GET `/api/reviews/active` | 200 `ReviewJobSchema` or 204 **empty body**, not JSON null |
| GET `/api/reviews/:reviewId` | 200 `ReviewJobSchema`; 404 unknown/malformed ID |
| POST `/api/reviews/:reviewId/cancel` | 200 `ReviewJobSchema`; idempotent for terminal jobs |
| GET `/api/reviews` | 200 `{items:[{review:ReviewJob,status,overallRisk,findingCount}],nextCursor:string|null}` |
| GET `/api/reviews/:reviewId/events` | Unnamed SSE messages with JSON `ReviewEventSchema` data and decimal sequence `id` |
| GET `/api/reviews/:reviewId/report.md` | Stored sanitized Markdown, attachment, `text/markdown; charset=utf-8`; 404 until available |
| GET `/api/reviews/:reviewId/report` | 200 existing `VerifiedReportSchema`; 404 until available |

**Compatibility decision: structured report.** The final route above is an additive platform HTTP adapter over the unchanged engine `ReportQueryService.getReport()`. This resolves Gemini's isolated `ReportIntegrationService` mismatch. It uses the already-existing `VerifiedReportSchema`; there are no shared DTO/schema changes, no envelope embedding, and no report logic duplicated or engine-owned file edits. Gemini can keep its adapter's exact route and schema.

One main verifier is required; 1–8 distinct reviewer provider/model pairs are accepted. Concurrent reviewer execution is capped at 3. A 409 create response carries `activeReviewId`; link to that review. Provider/model unavailability produces 422. `ReviewJob.reviewers` contains reviewer runs, not the verifier run. The verifier stage appears through job state. `ReviewJob` has no failureReason field; use its warnings and terminal state.

History query keys: `limit` (1–100, default 25), `cursor`, `status`, `risk`, `provider`, `repository`, `from`, `to`, `q`. Status: `active`, `completed`, `completed_with_warnings`, `failed`, `cancelled`. Risk: `clean`, `low`, `medium`, `high`, `critical`; dates are ISO UTC strings. Unknown keys reject with 400. Pass `nextCursor` unchanged.

Use `EventSource('/api/reviews/'+id+'/events')` at the same origin. `onmessage` receives every event; the type discriminator is inside JSON, not the SSE `event:` name. The first message is always `job.snapshot` with `payload.job`; other types are `job.state_changed`, `reviewer.state_changed`, `job.warning`. Sequence allocation is persisted per job and never decreases across reconnect/restart. Reconnect is snapshot recovery, not replay of all historical messages; Last-Event-ID does not request a replay. Replace UI state with the new snapshot and ignore stale subsequent sequences. Close EventSource explicitly when a terminal snapshot/state (`completed`, `failed`, `cancelled`) arrives so its normal server completion does not cause endless retries. SSE authorization is checked on connection; logout should close the UI's open streams.

Reports are immutable. Markdown remains primary and must be rendered using the UI's safe Markdown path. The API provides no Azure comments/votes/approval, patches, builds, tests, dependency installs, commits or pushes for inspected repositories.

## Verification and pending integration

See `docs/backend-verification.md` for exact fresh gates and skips. Root `npm run e2e` now runs backend startup/auth/settings/standards, HTTP review lifecycle and SSE restart tests; it is not Playwright/browser coverage. `node scripts/smoke-backend.mjs` runs the compiled service with disposable data, real SQLite and a Credential Manager read, never changing account/PAT or calling Azure/models.

Azure CLI is not installed on this host, so CLI auth and real Azure access remain unverified; fake REST/token/Git tests cover their mechanics. No live/paid model review or external-context sandbox experiment was run. Gemini's UI merge and full browser login/settings/standards/review/cancellation/reconnect/report gate remain outstanding. Known dependency audit findings from the earlier install remain unresolved.
