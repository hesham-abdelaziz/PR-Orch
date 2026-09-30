# Provider quota verification

Date: 2026-09-30, Africa/Cairo. Native Windows, Node v24.18.0.
Worktree: `C:/Users/EGDev06/.codex/worktrees/provider-quota/x20`.
Branch: `feat/provider-quota-visibility`; committed base `4852567`.

Backend quota capability is implemented; Gemini UI integration, integration-branch
import and browser acceptance remain pending. See `provider-quota-handoff.md` for
the official-source matrix, exact contracts and safe integration instructions.
No active branch was merged/moved, no existing dirty changes were copied, and no
engine-owned or Angular files were modified. No pushes or deployments.

## Fresh gates

| Command | Result |
| --- | --- |
| `npm ci` | Exit 0; 579 packages installed. Five existing vulnerabilities (2 low, 1 moderate, 2 high); four pending optional install-script approvals. No blanket approval or dependency upgrade. |
| Baseline contracts build and `npm test` before implementation | Exit 0; API 49 files / 665 passed, 4 skipped; web 16 files / 103 passed; contracts 6 passed. |
| Initial quota tests before implementation | Failed because the new source modules were absent, then passed after implementation. |
| Reviewer regression tests before fixes | Two failed as expected: prior-account quota preserved on failed refresh; TTL expired before advertised expiration after a slow read. Both passed after fixes. |
| Final `npm test` | Exit 0; API 52 files / 695 passed, 4 skipped (699 total); web 16 files / 103 passed; contracts 2 files / 8 passed. Total 806 passed / 4 skipped. |
| Final `npm run lint` | Exit 0; API type-aware static analysis, Angular development build, contracts typecheck. |
| Final `npm run build` | Exit 0; contracts, Nest API and Angular production build. This builds the committed baseline UI; it has no quota component. |
| Final `npm run e2e` | Exit 0; 4 backend files / 6 passed, including startup, durable fake review lifecycle, single-active-job behavior, cancellation, HTTP/SSE restart and authenticated platform routes. Not browser coverage. |
| `node scripts/smoke-provider-quotas.mjs` | Exit 0; Claude 2.1.280, Codex 0.159.2 and Gemini 0.60.0 version/help probes succeeded. Claude auth boolean true. Codex app-server stdio supported and quota read available: 75% remaining primary/300m, 81% secondary/10080m at probe time. No machine-readable standalone quota/usage subcommand listed for Claude/Gemini. |
| `node scripts/smoke-windows.mjs` | Exit 0; all installed CLIs detected and help/auth probes succeeded. Disposable namespaced Credential Manager roundtrip passed and cleaned up. Existing credentials untouched. Gemini auth unknown until run. |
| `node scripts/smoke-backend.mjs` | Exit 0; loopback, migrations, account setup status, protected API and same-origin web passed using disposable data. No model/Azure calls. |
| `git diff --check` | Passed. |
| `git diff --name-only 4852567 -- apps/api/src/providers apps/api/src/reviews apps/api/src/reports tests/fixtures/fake-clis apps/web packages/contracts/src/providers.ts` | Empty. |
| Post-gate Win32_Process inventory | No fake-provider, quota fixture or cancellation-test descendant Node processes found. |

The four API skips are existing Windows file-symlink privilege cases. Real
directory-junction and process-tree tests ran. Existing Vite paths-plugin notice,
Git LF/CRLF notices and jsdom navigation warning remain; no new failing gates.

## Added regression coverage

Thirty API tests and two contracts tests cover explicit used-to-remaining
conversion; null/invalid/nonfinite/out-of-range values; multiple windows and pools;
legacy-view deduplication; shared scope and forbidden model allocation; unsupported
sources/authentication, missing login and errors; partial failures; TTL and slow
read expiration; forced-refresh throttle; in-flight deduplication; detached cache
responses; cleared historical quota on failure/account change; bounded process
timeout, malformed JSON, early exit, stderr/stdout floods; pre-abort and live
Windows descendant cancellation; denied Azure/other-provider/NODE_OPTIONS
environment; static diagnostics and discarded account/secret payloads; protected
GET/POST routes, same-origin enforcement, JSON schema and 429 responses. Automated
quota source tests use a synthetic local JSON-RPC fixture outside engine fixtures.
Full existing review creation/orchestrator regressions pass; quota has no review
creation dependency and missing quota cannot gate reviews.

Independent read-only review identified account-switch stale-data reuse and the
TTL anchor mismatch. Tests reproduced both; fixes clear previous measurements
on failed reads and align expiration with refresh completion. Reviewer rechecked
the changes and reported no remaining important issue. Their recheck did not
rerun tests; the final suite/build/lint/e2e evidence above is separate.

## Limits

Only Codex managed ChatGPT account quota is supported by the current runtime
adapter. Claude/Gemini are honestly unavailable. No API-credit/plan-credit
percentages or model-specific mappings are inferred. Returned cached readings
are snapshots; account changes within the 60-second TTL require explicit refresh
or the next cache miss. Refresh failure clears old measurements because account
continuity is unknown. UI must show elapsed/reset snapshots as locally stale and
must not retain them after an error/unauthenticated response.

No live model request/review, sandbox external-context experiment, Azure read/write,
browser session access, credential extraction, login/configuration changes or
purchases occurred. Supported Codex reads let the CLI handle its existing managed
authentication; the app never requests token refresh or accesses token files.
Process-tree cleanup is bounded best effort; no new Windows Job Object boundary.
No engine-owner change is required. UI/browser gate and incorporation into the
concurrently edited integration worktree remain the integration owner's work.
