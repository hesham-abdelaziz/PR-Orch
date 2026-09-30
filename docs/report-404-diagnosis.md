# Report 404 and CSP diagnosis

Date: 2026-10-01, Africa/Cairo.
Review: `1d846ee7-ee78-4267-9015-3d3a74dc1f81`.

Read-only inspection of the existing application database proves the job is
failed, during reviewing. Its sole Gemini flash reviewer exited with code 41
after one attempt. Stored sanitized diagnostics identify IneligibleTierError /
UNSUPPORTED_CLIENT: the signed-in account was rejected by Gemini CLI. Claude opus
verifier was cancelled with zero attempts. Reports table has zero rows for this
job. Thus GET /api/reviews/:id/report returning 404 is correct; no final report
was generated. No model rerun was performed and no fabricated report was created.

The screenshot's inline-script error is a separate platform bug: Angular's
critical stylesheet loader is inline while script-src allowed only self. New
platform/web-csp.ts hashes executable inline scripts from the trusted local build
index, using browser-normalized line endings. It bounds index size/hash count,
ignores external/data scripts and preserves all existing CSP directives without
adding unsafe-inline to script-src. Bootstrap builds the policy at startup.

Isolation: fix/dashboard-runtime-diagnostics in
C:/Users/EGDev06/.codex/worktrees/report-runtime/x20, from a5d7acd. The base already
includes Gemini's review-navigation and quota UI commits. No Angular or
engine-owned source files changed. Existing integration dirty files were untouched.
The runtime JavaScript comparison found bootstrap.js as the only changed existing
backend file, plus the new CSP helper. Provider/review/report logic is identical
to the previously running quota worktree build.

Fresh verification:

- CSP startup test failed without the hash, passed with the fix.
- CRLF hashing regression failed before normalization, passed after it.
- Final npm test: API 53 files / 696 passed and four existing privilege skips;
  web 20 files / 134 passed; contracts 8 passed. Total 838 passed, four skipped.
- npm run lint, npm run build and npm run e2e passed; e2e four files / six tests.
- Independent read-only review found no blocker; the newline robustness finding
  was subsequently covered by the red/green regression test.
- Existing CSS budget warnings remain for provider-status-card and report-page;
  these are below their error budgets. Existing dependency audit findings remain.

Live application: confirmed no active reviews before stopping old PID 26872.
Started the verified build hidden on loopback port 3000 as PID 52824, using the
same default existing data directory and no credential/configuration changes.
Application runtime now runs from report-runtime/x20/apps/api. Existing account
was preserved; root returns 200, updated failed-review bundle is served, and the
single inline script's hash matches CSP. Arbitrary inline scripts remain blocked.
In-app browser loads the sign-in page with no console warnings/errors. That
browser lacks the user's Chrome session, so authenticated failed-review rendering
was not independently browser-verified; UI unit tests cover it. Do not claim a
report exists or that the provider authentication problem has been repaired.

User action: hard-refresh the existing signed-in page to discard previously loaded
UI code. A final report for this failed job cannot be recovered because there is
none. For a new review, select an already authenticated supported reviewer such
as Claude/Codex, or resolve Gemini's rejected authentication separately. No login,
provider credential changes, paid calls, Azure writes, merges or pushes occurred.

Restart this fixed runtime from PowerShell with:

```powershell
Set-Location 'C:/Users/EGDev06/.codex/worktrees/report-runtime/x20'
npm start
```

Stop the currently running instance before starting another; do not interrupt an
active review. Other worktrees must incorporate this commit to retain the CSP fix
when rebuilding their backend. The original quota and integration branches remain
unchanged by this task.
