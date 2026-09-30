# Runnable backend verification

Date: 2026-09-30, Africa/Cairo. Native Windows, Node v24.18.0.
Branch `feat/pr-orchestrator-integration`, worktree `C:/Users/EGDev06/.codex/worktrees/platform-integration/x20`.
Starting HEAD `10348d78b3abf13c2b2dce4c49f07c828a36e526`; starting working tree was clean. No reviewed repository, other owner checkout, shared contract, or engine-owned source was changed. No push/PR/deployment/Azure write/live model call was made.

## Delivered platform behavior

- Read-only, bounded Azure PR REST metadata/iteration/change requests with strict URL and response checks. Saved PAT has unconditional precedence; no fallback on PAT failure. Existing Azure CLI Entra tokens support both REST and authenticated Git fetch without an extension, interactive login or CLI configuration mutation.
- Raw and encoded saved/rotated PATs and acquired CLI tokens registered for synchronous engine redaction; sanitized metadata and diagnostics. Fetch authentication remains ephemeral environment configuration, with helpers/prompts/redirects disabled.
- Single-account auth/session/password endpoints, validated settings, status-only PAT management and standards replacement/content/status endpoints.
- Existing provider/review/history/cancellation/Markdown/SSE controllers imported unchanged. An additive platform JSON report adapter delegates to the existing engine read service and existing VerifiedReport schema.
- Persistent application data and forward migrations, IPv4 loopback listener, same-origin SPA serving, strict host/origin/session protection, no permissive CORS, security/no-store headers and sanitized central errors.
- Exclusive canonical-data-root runtime lease before recovery; interrupted jobs recovered before serving; orphan workspace sweep; engine cancellation before database shutdown and lease release.
- Runnable root `npm start`, compiled backend smoke and expanded root backend e2e command.

See `frontend-api-handoff.md` for exact routes, DTOs, run commands and explicit compatibility decisions.

## Fresh final gates

All commands run in the integration worktree; no paid/live models or live Azure requests. Final checks were approximately 14:48–14:53 Cairo, with additional compiled-startup verification afterward.

| Command | Result |
| --- | --- |
| `npm test` | Exit 0: API 49 files, **665 passed / 4 skipped**, 669 total; web scaffold 1 file / **3 passed**; contracts 1 file / **6 passed**. No failures. |
| `npm run lint` | Exit 0; API type-aware analysis with no warnings, Angular development build and contracts typecheck. |
| `npm run build` | Exit 0; contracts, API and Angular scaffold production build. Gemini UI is unmerged. |
| `npm run e2e` | Exit 0; **4 backend files / 6 tests passed**, no skips. Includes compiled-configuration startup behavior, account/settings/standards, HTTP lifecycle/single-active-job/immutable snapshots/structured and Markdown reports/shutdown cancellation, and persisted HTTP/SSE restart. **Not browser coverage.** |
| `node scripts/smoke-backend.mjs` | Exit 0; compiled app, real SQLite migrations and Windows Credential Manager read, loopback binding, setup session, protected API and same-origin scaffold. Disposable data removed after shutdown; no account/PAT mutation. |
| `node scripts/smoke-windows.mjs` | Exit 0; all three providers detected. Claude 2.1.280 and Codex 0.159.2 authenticated; Gemini 0.60.0 authentication unknown until run. Disposable namespaced Credential Manager roundtrip passed. No model review invocation. |
| `npm start` with disposable `PR_ORCHESTRATOR_DATA_ROOT` and `PORT=39031` | Actual command started `node dist/main.js`. Native TCP inventory confirmed sole IPv4 loopback listener; `/api/auth/session` returned unauthenticated/setup-required and SPA navigation returned 200. Stopped with Ctrl+C (terminal exit 1 from intentional interruption); listener absent afterward. |
| `git diff --check` | Exit 0. |
| `git diff --name-only 10348d7 -- apps/api/src/providers apps/api/src/reviews apps/api/src/reports tests/fixtures/fake-clis packages/contracts` | Empty; ownership boundaries/shared contracts preserved. |

The four skips are the existing engine Windows file-symlink tests requiring unavailable symlink privileges (three checkout-inspector cases and one native-resolver executable case). Real directory-junction and process-tree tests ran. Final Win32_Process inventory found zero fixture/fake-provider/Git-alias Node processes; the startup smoke listener was gone.

## Regressions and review

Azure tests cover PAT consistency/failure, CLI bearer fetch headers, remembered token encodings, metadata redaction, HTTP/auth errors, malformed responses, pagination, source-revision mismatch, valid target drift and URL traversal/identifier errors. Git tests inspect ephemeral header configuration and preserve real Windows descendant cancellation tests.

An independent read-only review identified duplicate-instance recovery corrupting a live job and orphan checkouts left by crashes during prepare. Added an OS-held lease before initialization and confined startup sweep; regressions pass. It also identified Azure iteration target drift, resolved using Microsoft's different iteration/merge snapshot semantics and a failing-then-passing regression. The post-fix reviewer found no remaining important issue in that scope.

Compiled smoke found two additional issues missed by source-mode tests: copied Windows `Path` casing and SPA index serving from a dot-prefixed checkout ancestor. Both were reproduced by failing regressions and fixed; native compiled smoke then passed. Full gates were rerun after these fixes.

## Explicit limits / next work

- Real Azure authentication remains unverified: this host has no Azure CLI and no live Azure PR request was run. Fake token/REST tests and Git environment tests prove mechanics rather than live tenant/repository authorization.
- Azure validation line additions/deletions are unavailable placeholders (`0`), not measured zero. Gemini must hide/label them unavailable. Existing nonnullable contract retained; accurate line-count presentation needs a later explicit capability/contract decision. The workspace independently checks actual diff/file limits.
- Gemini UI has not been merged. Complete dashboard/browser acceptance requires that integration and browser tests for auth, settings/standards replacement, reviews/cancellation, SSE reconnect and safe reports.
- CLI flag/help detection does not prove provider sandbox access outside the checkout. No sandbox access experiment or paid model review was run.
- Earlier npm dependency audit findings (2 low, 1 moderate, 2 high) and optional install-script approval findings remain; this work does not claim to resolve them. Existing install was used for the fresh gates; `npm ci` was not rerun in this turn.
