# Review engine (`apps/api/src/reviews`, `apps/api/src/reports`)

Coordinates one pull-request review from creation to a terminal state and
produces the canonical, immutable report. All reviews are **static code
inspection**: nothing here writes to Azure DevOps, modifies the inspected
repository, or receives an Azure PAT.

## Pipeline

```
createReview ─ validate request → active-job precheck → providers selectable → PR validate
             → [mutex] re-check active → standards snapshot (once) → createJob + queued runs (one transaction)
queued → preparing → reviewing → verifying → rendering → completed
   └────────── any non-terminal state → failed | cancelling → cancelled
```

1. **preparing** – `ReviewWorkspacePort.prepare` (aborts on cancel).
2. **reviewing** – up to `min(3, settings.maxParallelReviewers)` reviewer processes at once. Each reviewer gets an independent prompt (it never sees other reviewers or their findings). One malformed structured answer gets exactly **one** correction attempt; a second failure fails that reviewer only.
3. Continue if **at least one** reviewer completed; otherwise the job fails (`All reviewers failed…`). Failed/timed-out reviewers become job warnings (“results are partial”).
4. **verifying** – the main verifier receives every candidate (stable ids, reviewer origins). `verifier-report.assembler.ts` enforces the structural and objective checks described in *Verified-finding checks*. A violation earns the single correction attempt, then the job fails with no report. With zero candidates the verifier is skipped and the report is `clean`.
5. **rendering** – Markdown is rendered from the validated structured report only (`reports/report-renderer.service.ts`): HTML escaped, unsafe links/images removed, model text cannot forge headings, coverage exclusions and warnings disclosed, rejected claims only in the collapsed audit section.
6. `completeJob` atomically moves `rendering → completed` and stores the report; if cancellation won the race it is refused and the job ends `cancelled` with no report.
7. Always: workspace cleanup (failure keeps the job’s state, sets `cleanupPending`, adds a warning, and is retried by `retryPendingCleanups`), scratch schema-file removal, terminal SSE event.

Overall risk = highest verified severity or `clean`. There are no numeric scores, confidence values, consensus votes or patch generation.

## HTTP surface (full `api/` prefix is in the decorators — do **not** also set a global `api` prefix)

| Route | Behavior |
| --- | --- |
| `POST /api/reviews` | 201 `ReviewJob` (state `queued`, one queued run per reviewer). 400 invalid body (`issues[]`), 409 `{activeReviewId}`, 422 provider/model not ready. PR-validation errors propagate unchanged for the platform’s filters. |
| `GET /api/reviews/active` | 200 `ReviewJob`, or **204** when none. |
| `GET /api/reviews` | 200 `{items:[{review,status,overallRisk,findingCount}], nextCursor}`. Query: `limit` (1–100, default 25), `cursor`, `status`, `risk`, `provider`, `repository`, `from`, `to`, `q`. Unknown keys → 400. |
| `GET /api/reviews/:reviewId` | 200 `ReviewJob` / 404. |
| `POST /api/reviews/:reviewId/cancel` | 200 `ReviewJob` (`cancelling` or already terminal; idempotent) / 404. |
| `GET /api/reviews/:reviewId/events` | SSE. Unnamed messages, `data` = JSON `ReviewEvent`, `id` = sequence. First message is always `job.snapshot`; stream completes after the terminal state. Sequences come from the persisted per-job counter (see *SSE sequences*). |
| `GET /api/reviews/:reviewId/report.md` | `text/markdown; charset=utf-8`, `attachment`, `nosniff`; 404 unless completed. |

Authentication is the platform’s global guard; nothing here checks sessions.

## Verified-finding checks

Deterministic checks against the immutable prepared checkout (`output/checkout-inspector.ts`, `output/finding-evidence.validator.ts`):

| Check | Reviewer candidates | Accepted / merged findings |
| --- | --- | --- |
| Path is a normalized relative path inside the checkout (no traversal, drive, UNC, URL) | dropped | correction |
| File exists, is a regular file, is not `.git` metadata, not binary, ≤ 1 MiB, not in the workspace's exclusions | dropped (job warning) | correction |
| Real path (after symbolic links, junctions, reparse points) stays inside the real checkout path | dropped | correction |
| Cited line range exists in the file | dropped | correction |
| Evidence quotes ≥ 1 code excerpt in backticks that appears at the cited lines ± 3 (whitespace-normalized; `[REDACTED]` is a gap) | — | correction |
| Location is in or within 15 lines of a referenced candidate in the same file, or `locationCorrection` explains the move | — | correction |
| Each candidate decided exactly once; accepted = 1 id, merged ≥ 2; no unknown ids | — | correction |
| Finding id and origins derived by the engine from the referenced candidates only (the wire schema has no `origins`/`id`) | — | enforced |

Wording and severity may change freely, and duplicates may be merged. Each final finding stores a `verification` audit: the referenced candidates (id, title, severity, location), whether it was relocated and why, the line where the quoted evidence was found, and whether the severity changed.

What these checks do **not** prove: that the claim about the quoted code is correct, that the severity is right, that merged candidates really describe the same defect, or that a relocation's explanation is true. Those remain the main verifier's judgment; the audit makes them reviewable.

## Redaction of model-authored text

- Reviewer and verifier output is redacted **once, at the parse boundary** (`output/redact-model-output.ts`), before normalization. Every string field is covered: titles, evidence, impact, suggested fixes, references, location descriptions, file paths, exclusion reasons, reviewer and verifier warnings, rationales and the executive summary. Everything downstream (candidates, run results, the verifier prompt, stored report JSON, Markdown, job warnings, SSE snapshots, history) is derived from the redacted copy.
- Failure reasons, run warnings and sanitized logs go through the same policy (`redactSecrets` with known values), and so do HTTP error messages (`409`, `422`, `400` issue text).
- Policy (`providers/redact-secrets.ts`): exact known secret values plus credential shapes with distinctive structure (private-key blocks, `sk-…`, `AIza…`, `gh*_…`, `github_pat_…`, `AKIA…`, `xox?-…`, digit-bearing `Bearer` tokens, JWTs, 52-char Azure DevOps PATs, `user:password@` in URLs, and quoted literals assigned to secret-named keys). Ordinary identifiers, hashes, template placeholders (`${token}`) and prose such as “Bearer authentication” are left intact.
- Exact-value redaction uses `ReviewOrchestratorOptions.secretValues` (default: secret-looking environment variables). **The platform should supply the saved Azure PAT here** (via `REVIEW_ORCHESTRATOR_OPTIONS`), since it is not in the environment.
- A redacted quote no longer matches the source verbatim; evidence anchoring (below) treats `[REDACTED]` as a gap.

## SSE sequences

- Every event number is allocated from `review_jobs.event_sequence` through `ReviewRepository.allocateEventSequence` (atomic increment-and-return). The value never decreases: not on reconnect, not after the job is terminal, not after a restart.
- A subscriber is registered, then reads the persisted sequence `S`, then loads the snapshot. The snapshot carries `S`; buffered events `<= S` are dropped (already reflected), events `> S` follow it. No subscriber ever receives the same or a lower sequence twice.
- The orchestrator emits an event only **after** persisting the change it announces (reviewer warnings are now emitted after `updateJob`). This is what makes dropping `<= S` safe.
- Events for one review are numbered and delivered in emission order through a per-review promise chain. In-memory state (listeners, chain) exists only while a review has subscribers or undelivered events; `trackedReviewCount()` exposes it for tests. There is no in-memory counter to lose.
- If allocation fails (database error) the event is skipped rather than numbered from memory; the client recovers the state from its next snapshot.

## What the platform (Codex) must supply

Bind these tokens in a module visible to `ReviewsModule`/`ReportsModule` (for example a `@Global()` platform module), then import `ReviewsModule` in `AppModule`:

| Token (`review-ports.ts` / `review-repository.ts`) | Contract |
| --- | --- |
| `REVIEW_REPOSITORY` | `ReviewRepository` backed by SQLite (see below). `InMemoryReviewRepository` is the executable reference. |
| `REVIEW_WORKSPACE_PORT` | `prepare({reviewId, pullRequest, standards}, signal)` → `PreparedWorkspace`; `cleanup(workspaceId)` idempotent. `prepare` must remove anything it created if it throws. |
| `REVIEW_STANDARDS_PORT` | `snapshotForReview(reviewId)` → immutable, hash-addressed copy (`storagePath`) + `StandardsMetadata`, or `null`. Called once per accepted job. |
| `REVIEW_SETTINGS_PORT` | `get()` → `Settings` (frozen into the job at creation). |
| `REVIEW_PULL_REQUEST_PORT` | `validate(url)` → `PullRequestSummary`, enforcing the hard PR limits. |

`REVIEW_PROVIDER_PORT` is bound inside `ReviewsModule` to `ProviderRegistryService`. `PROVIDER_SNAPSHOT_STORE` (in `providers.module.ts`) may be overridden with a `provider_snapshots` table.

### Workspace port assumptions (`PreparedWorkspace`, resolved by `workspace-layout.ts`)

| Field | Meaning |
| --- | --- |
| `rootPath` | Platform-managed per-job directory holding the context files. May or may not contain the checkout. Never the provider cwd unless it equals `checkoutPath`. |
| `checkoutPath` | **Required.** Absolute root of the source-revision checkout. It is the provider cwd (Codex also gets `--cd`), the root every finding `filePath` is relative to, and the tree that finding locations are validated against. |
| `diffPath`, `metadataPath`, `technologyManifestPath` | Absolute. Preferably inside `rootPath` and outside the checkout, so they are never mistaken for PR files. If inside the checkout they are labelled as review context in the prompt. |
| `standardsPath` | Absolute path of the job's standards copy, or `null` to use the standards snapshot's `storagePath`. |

- All paths use one flavor: Windows drive paths (`C:\…`, either separator, compared case-insensitively) or POSIX. Mixed flavors, relative paths and UNC paths fail the job before any provider runs (`The prepared workspace layout is invalid: …`).
- Context files outside the checkout are made readable as **read-only directories**: the workspace root when the file is inside it, otherwise the file's own directory (for a standards snapshot in app data). Claude receives `--add-dir <dir>` (needed because `--restricted` confines file tools to the working directories; plan mode and the `Read,Grep,Glob` tool list keep it read-only). Gemini receives `--include-directories <dir,dir>`. Codex receives nothing: its `read-only` sandbox can read the filesystem, and `codex --add-dir` would grant **write** access, so the command policy forbids it.
- The prompt names the checkout as the working directory, lists each context file by absolute path with “outside the checkout, read-only” or its checkout-relative location, and tells the model to report paths relative to the checkout.
- The engine never writes into `rootPath` or the checkout; its JSON-schema scratch files live in the OS temp directory.

### Entities and migration (`003-review-engine`)

TypeORM is not installed on this branch; records are plain shapes in `entities/`. Map them to tables:

- `review_jobs` (`ReviewJobRecord`): `id` PK; `state`; **`event_sequence INTEGER NOT NULL DEFAULT 0`** (only changed by `allocateEventSequence`; never by `updateJob`/`transitionJob` patches); `pull_request` JSON; `main` JSON; `reviewers` JSON; `additional_instructions` NULL; `standards` JSON NULL; `standards_storage_path` NULL; `settings` JSON; `warnings` JSON; `exclusions` JSON; `failure_reason` NULL; `workspace_id` NULL; `cleanup_pending` bool; `overall_risk` NULL; `finding_count` NULL; `created_at`; `updated_at`; `completed_at` NULL. Index `created_at DESC, id DESC` for history paging.
- `reviewer_runs` (`ReviewerRunRecord`): `id` PK; `job_id` FK; `role` (`reviewer`|`verifier`); `selection` JSON; `state`; `started_at`; `completed_at`; `warning`; `attempts`; `sanitized_log` (≤ 4 KiB, redacted); `result` JSON NULL.
- `candidate_findings`: **PK (`job_id`, `id`)** — candidate ids are content-derived and repeat across jobs; `run_id` FK; `finding` JSON.
- `final_findings`: **PK (`job_id`, `id`)**; `finding` JSON; `decision` JSON; **`verification` JSON NOT NULL** (`FindingVerificationAudit`).
- `reports` (`ReportRecord`): `job_id` PK/FK; `report` JSON; `markdown`; `duration_ms`; `created_at`. Never updated.

Single-active-job guarantee (the database is the authority):

```sql
CREATE UNIQUE INDEX ux_review_jobs_single_active ON review_jobs ((1))
  WHERE state NOT IN ('completed', 'failed', 'cancelled');
```

Atomicity the SQLite adapter must provide:

- `createJob(record, initialRuns)`: one transaction inserting job + runs; a unique-index violation returns `{created:false, activeJobId}` and inserts nothing.
- `transitionJob`: `UPDATE … WHERE id=? AND state=?` (compare-and-set); `applied:false` when 0 rows changed, returning the current row.
- `completeJob`: one transaction — CAS `rendering → completed`, insert `reports` and `final_findings`, apply the patch; refuse (`applied:false`) when the job is no longer `rendering`.
- `listJobsPendingCleanup`: **terminal** jobs with `cleanup_pending = 1`.
- `allocateEventSequence(jobId)`: `UPDATE review_jobs SET event_sequence = event_sequence + 1 WHERE id = ? RETURNING event_sequence` (SQLite ≥ 3.35), or the equivalent inside one transaction; `null` when no row matched. `getEventSequence(jobId)`: `SELECT event_sequence … WHERE id = ?`, `null` when missing.
- `queryJobs`: keyset pagination on (`created_at`, `id`) with the documented filters; `status` is derived by `history-status.ts` (`active`, `completed`, `completed_with_warnings`, `failed`, `cancelled`).

Startup: `ReviewOrchestratorService.onApplicationBootstrap` runs recovery (jobs left active become `failed`, or `cancelled` if cancelling; the lock is freed; leftover workspaces are cleaned). Call `app.enableShutdownHooks()` so running reviews are cancelled and provider process trees are killed on exit.

## Shared-contract observations (no contract was changed)

- No response schemas exist for cancel, history items/pages, or the empty `active` case; the engine returns `ReviewJob`, `{items,nextCursor}` and 204 respectively. Consider adding schemas in a later contract commit.
- `ReviewJob.reviewers` lists reviewer runs only; the verifier’s run state is not exposed to clients.
- SSE has no verifier events; verifier progress is visible only as `verifying`.

## Known limitations / deferred

- More than ~1000 candidate findings cannot be verified in one pass (`VerifierOutput` allows 1000 decisions); realistic runs are far below this. No sharding.
- The verifier is a single model call with one correction; no second-opinion pass.
- History does one `listRuns` per row (≤ 100 rows); batch it in the SQL adapter if needed.
- Provider CLI flag sets track the versions documented in `providers/README.md`; a CLI upgrade that renames a flag disables that provider at the next probe or fails the run with an actionable message rather than falling back to a less safe mode.
- No live/paid provider test is included; an opt-in manual smoke review is the platform’s final-gate task.

## Tests

`npm --workspace @pr-orchestrator/api test -- providers reviews reports` (deterministic fake CLIs; no network, no paid calls).
