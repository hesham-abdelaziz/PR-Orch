# Platform / corrected engine integration

Date: 2026-09-30 (Africa/Cairo)
Branch: `feat/pr-orchestrator-integration`
Worktree: `C:/Users/EGDev06/.codex/worktrees/platform-integration/x20`
Platform migration commit: `f96263c`. Corrected engine head: `cc94abf`; integration merge: `366155e`.

## Implemented

- Forward-only TypeORM migrations 001–004, WAL, foreign keys and busy timeout. Migration 003 adds nonnegative event_sequence defaulting to zero, required final_findings.verification JSON, composite per-job finding identities, and the partial single-active-job unique index. Migration 004 upgrades candidate run references to a composite (job_id, run_id) foreign key, preserving valid existing candidates and rejecting inconsistent data.
- SqliteReviewRepository: synchronous SQLite transactions on TypeORM's native connection, atomic job/run insertion and completion/report/audit insertion, state CAS, SQL keyset pagination, and one UPDATE RETURNING per sequence allocation. Patch allowlists prevent sequence resets and state bypass.
- PlatformModule.forRoot: exports corrected engine tokens and the saved-PAT redaction callback; no engine-owned file edited.
- Single-account Argon2id authentication, hashed opaque sessions, expiry and password-change revocation. Validated settings and immutable hash-addressed standards. Windows Credential Manager adapter through just-secrets.
- Rotated PAT values remain available for redaction until shutdown; 128 distinct values is the safety cap, requiring restart rather than forgetting an old value.
- Real Git workspace with separate checkout and context, fetch-only authentication, disabled push target, exclusions, bounds, and scoped idempotent cleanup.
- Nest integration test: real temporary Git checkout, real SQLite, fake providers, persisted verification audit, saved-PAT scan across storage/HTTP/SSE, and HTTP SSE reconnect after app restart.
- Independent review reproduced cross-job repository corruption and lingering Git descendants. Regression tests failed before fixes and passed afterward. Run identity checks, transactional ownership checks and composite FKs now prevent cross-job writes. Git abort, timeout and output-limit paths terminate the real Windows tree; all three tests assert that the child PID is gone before returning. Tree termination is OS-dependent best effort with bounded waits, not a Windows Job Object security boundary.
- Git diff output cap now uses the configured hardDiffBytes rather than an unconditional 6 MiB cap. Authentication concurrency tests use the actual winning account instead of assuming which password hash finishes first.

## Remaining platform scope

This is a tested platform/engine binding, not the completed runnable dashboard.
PlatformModule currently requires the real Azure PR-validation callback; tests use a fake Azure response. Production Azure REST/CLI clients, full dashboard HTTP controllers, AppModule startup wiring and browser Playwright tests remain outstanding. HTTPS Git fetch currently requires a PAT; Azure CLI fallback is not implemented and fails explicitly. The configurable workspace root is confined to application data for this MVP. UI corrections and its report-response contract remain pending; UI has not been merged.

## Engine-owner requirements

1. Installed Claude 2.1.280 uses an npm .cmd wrapper launching `%dp0%/node_modules/@anthropic-ai/claude-code/bin/claude.exe`. WindowsCliResolver only accepts JavaScript shim targets and therefore fails to detect Claude. Support trusted native npm launch targets with absolute containment validation and shell:false; use the real shim shape in regression tests.
2. `discoverConfiguredModels > reads the default model each CLI is configured with` fails on Windows: injected fake filesystem keys are POSIX while native joining produces Windows paths. Match the test path flavor to its platform and retain Windows config-path coverage.
3. Gemini sandbox mounts for include-directories and Codex sandbox reads outside --cd remain unproven. Help accepting a flag does not prove filesystem access. No paid model invocation was run.

## Windows smoke

- Node v24.18.0; better-sqlite3 12.11.1 bundles SQLite 3.53.2 (RETURNING supported).
- Claude 2.1.280: authenticated; help lists restricted, permission-prompts, add-dir and json-schema. Diagnostic native invocation succeeds; engine detection fails.
- Codex 0.159.2: authenticated using ChatGPT; resolver prefers native exe; required flags appear in exec help.
- Installed Codex exec help describes --add-dir as directories writable alongside the primary workspace. The integration test confirms it is not sent for review context.
- Gemini 0.60.0: resolver uses Node plus bundle/gemini.js; required flags appear in help; authentication unknown_until_run.
- Disposable namespaced Windows Credential Manager write/read/delete passed. No existing credential overwritten.
- Windows process-tree tests passed. Directory-junction inspector case ran; three file-symlink cases skipped for missing privileges.
- No leftover fixture node.exe processes were found after the engine run.
- Smoke script exits 1 while the engine cannot detect installed Claude. It prints only paths/statuses, never secrets.

## Verification

All checks below ran on Windows with synthetic secrets and fake provider output; no Azure or paid model calls. Commands without an alternate directory run from the integration worktree above.

| Command | Result |
| --- | --- |
| `npm ci` | Exit 0; installed 575 packages, audited 579. npm reported 5 dependency vulnerabilities; not claimed resolved. |
| `npm --workspace @pr-orchestrator/api test -- migrations.spec.ts sqlite-review.repository.spec.ts platform-services.spec.ts platform.module.spec.ts workspace.service.spec.ts git-process.service.spec.ts` | 6 files / 25 tests passed. Includes real 003-to-004 upgrade, real SQLite transactions and sequences, Git descendant cancellation, and HTTP/SSE restart/PAT scan. |
| `npm test` | Exit 1: API 40 files passed / 1 failed; 606 tests passed, 1 failed, 3 skipped (610 total). Web scaffold 3 passed; contracts 6 passed. Only failure is the engine-owned Windows model-catalog test listed above. |
| `npm run lint` | Exit 0; API static analysis, contracts typecheck, Angular development build passed. |
| `npm run build` | Exit 0; contracts, API and Angular scaffold built. This is not the unmerged Gemini UI. |
| `npm run e2e` | Exit 0; 1 backend HTTP integration test passed. This is not browser/Playwright coverage. |
| `node scripts/smoke-windows.mjs` | Exit 1 intentionally: installed Claude is not engine-detected. All three CLI versions/help probes succeeded; disposable credential roundtrip passed. Gemini auth remains unknown. |
| `npm ci` in `C:/Users/EGDev06/Documents/Codex/2026-09-29/x20-engine` | Exit 0. |
| `npm run build --workspace @pr-orchestrator/contracts`, then `npm --workspace @pr-orchestrator/api test -- providers` in the engine worktree | Contracts build passed; provider gate 12 files passed / 1 failed, 198 tests passed / 1 failed. Same Windows model-catalog failure. The contract build is needed after clean install because engine tests consume the built package. |
| `git diff --check` | Passed. |
| `git diff --name-only cc94abf -- apps/api/src/providers apps/api/src/reviews apps/api/src/reports tests/fixtures/fake-clis packages/contracts` | Empty: engine-owned files and shared contracts unchanged. |

The full engine suite ran its real Windows process-tree and directory-junction cases; three file-symlink cases skipped due to missing privileges. A Win32_Process inventory afterward found no fixture/fake-provider/Git-alias Node descendants.

The independent reviewer confirmed the original platform defects using real SQLite and a local Windows Git descendant. A requested post-fix reviewer pass could not run because its usage limit was exhausted; post-fix confidence comes from the regression tests and fresh gates above, not a claimed second independent approval.

## Next integration steps

1. Engine owner fixes Claude native shim discovery and the Windows model-catalog test without weakening read-only settings. Rerun Windows smoke and the full suite.
2. Platform owner supplies real read-only Azure validation/authentication, dashboard controllers and local-only startup wiring. Verify real authentication without paid review calls or Azure writes.
3. Merge the corrected Gemini UI after platform and engine, then run browser tests for login, settings/standards replacement, review creation, cancellation, SSE reconnect and sanitized Markdown reports.
4. Explicitly authorize a separate live-provider sandbox-access check if desired; the non-billable checks cannot prove access outside the checkout.
