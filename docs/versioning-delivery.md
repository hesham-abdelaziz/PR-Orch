# Application versioning delivery

Implemented by Claude Code (release tooling), Antigravity (dashboard), and Codex (coordination, integration fixes and verification).

The initial application version is `0.1.0`. The root package version drives the dashboard sidebar and Release Notes page. The authenticated `/release-notes` route renders `CHANGELOG.md` through the existing safe Markdown renderer. Frontend build/start/watch/test/lint commands regenerate release metadata.

## Use

```powershell
npm run release -- patch "Fix review display"
npm run build
npm start
```

The bump command also accepts `minor`, `major`, or a strictly increasing explicit SemVer, including prerelease/build metadata. A summary is required. It updates workspace versions, internal dependency pins, the lockfile, changelog and generated UI metadata. Review and commit these changes through your usual workflow. With shell-significant characters in a summary, invoke `node .\scripts\release.mjs` directly from PowerShell and quote the arguments appropriately.

Release changes are validated before writing and rolled back on handled write failures. This is not a crash-safe transaction; termination during a release or failed rollback may require restoring files. Numeric bump keywords increment the selected core component and remove any prerelease/build suffix; use an explicit version to graduate a prerelease to its matching stable version.

## Verification on 2026-10-02

- Production `npm run build`: passed. Existing report-page component style budget warning remains.
- Release tooling: 27 tests passed, including fixture bumps, invalid input without changes, SemVer ordering, and rollback.
- API: 891 passed, four skipped, using `npm --workspace @pr-orchestrator/api test -- --maxWorkers=2`.
- Contracts: 107 passed.
- Web: 251 passed, using a temporary runner configuration limiting workers to two.
- Real browser with an isolated temporary database/account: confirmed signed-out redirect to login, displayed `v0.1.0`, and dated changelog rendering.
- Workspace dependency tree: all three workspace packages and internal contracts references resolve to `0.1.0`.

Default `npm test` was run, but existing workspace Git-counting, provider cancellation, and review-coverage accessibility tests hit five-second timeouts at high parallelism. All suites passed in bounded reruns. To reproduce the web rerun without modifying repository configuration:

```powershell
'export default { test: { maxWorkers: 2 } };' | Set-Content "$env:TEMP\pr-orch-vitest-bounded.mjs"
npm --workspace @pr-orchestrator/web test -- --runner-config "$env:TEMP\pr-orch-vitest-bounded.mjs"
```

Antigravity returned its implementation report with a final service-unavailable diagnostic; its delivered files were independently built, reviewed, tested and checked in the browser by Codex. The release command does not publish, tag, push or commit changes. Existing user data and pre-existing handoff files were preserved.
