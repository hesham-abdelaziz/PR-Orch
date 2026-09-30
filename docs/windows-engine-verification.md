# Native Windows verification of the engine fixes

Date: 2026-09-30, Africa/Cairo (checks approximately 14:27–14:30).
Worktree: `C:/Users/EGDev06/.codex/worktrees/platform-integration/x20`
Branch: `feat/pr-orchestrator-integration`

Imported unchanged from Claude's engine branch:

- `e26c285`: native npm executable targets with real-path package containment.
- `331a34c`: configured-model discovery tests with explicit path-platform coverage.
- Local integration merge: `87b3931` (`Merge Windows provider discovery fixes`). No conflicts; no pushes.

## Commands and fresh results

All checks ran natively on Windows, Node v24.18.0. No model review requests or Azure writes were made. Fake-provider tests and disposable credential-manager probes do not use paid models.

| Command | Result |
| --- | --- |
| `git merge --no-ff 331a34c -m "Merge Windows provider discovery fixes"` | Exit 0; merged the seven engine-owned paths only. |
| `npm ci` | Exit 0; 575 packages added, 579 audited. Five reported vulnerabilities (2 low, 1 moderate, 2 high) remain. Four optional install-script approvals remain pending; no blanket approval was granted. |
| `npm run build --workspace @pr-orchestrator/contracts` | Exit 0. |
| `npm --workspace @pr-orchestrator/api test -- windows-cli-resolver model-catalog claude.adapter --reporter=verbose` | Exit 0; 3 files, 46 passed / 1 skipped (47 total). |
| `npm test` | Exit 0; API 41 files, 630 passed / 4 skipped (634 total); web scaffold 3 passed; contracts 6 passed. No failures. |
| `npm run lint` | Exit 0; API static analysis, web development build and contracts typecheck passed. |
| `npm run build` | Exit 0; contracts, API and web scaffold built. Gemini UI has not been merged. |
| `npm run e2e` | Exit 0; 1 backend HTTP/SSE integration test passed. Not browser coverage. |
| `node scripts/smoke-windows.mjs` | Exit 0; all three installed providers engine-detected; versions/help probes succeeded; disposable credential roundtrip passed. |
| `where.exe claude codex gemini` | Exit 0; Claude/Gemini npm wrappers in `C:/Program Files/nodejs`; Codex npm wrappers there and in roaming npm, plus the native Codex executable. |
| `git diff --name-only 331a34c -- apps/api/src/providers apps/api/src/reviews apps/api/src/reports tests/fixtures/fake-clis packages/contracts` | Empty: imported engine files and shared contracts match engine head exactly. |

## Real Windows filesystem cases

The verbose targeted test output explicitly confirms:

- Regular native package file: passed.
- Native target is a directory: passed (rejected as required).
- Package directory junctioned outside the shim tree: passed (rejected as required).
- Executable symlinked outside: skipped with `creating file symbolic links needs the Windows symlink privilege`.

The full suite's other three skips are checkout-inspector file-symlink cases for the same privilege limitation. Directory-junction and process-tree tests ran. A Win32_Process check after the gates found no fixture/fake-provider/Git-alias Node descendants.

## Installed provider checks

| Provider | Actual installed result |
| --- | --- |
| Claude | Version 2.1.280; installed, supported and authenticated. Required flags present. Native executable, no Node prefix. |
| Codex | Version 0.159.2; native executable still preferred; authenticated; required flags present. |
| Gemini | Version 0.60.0; Node plus `bundle/gemini.js` unchanged; required flags present; authentication remains unknown until a run. |

In addition to the smoke script, a `node --input-type=module -e` probe instantiated the compiled ClaudeAdapter with ProcessSupervisor and WindowsCliResolver, then called only `detectInstallation()` and `checkAuthentication()`. Sanitized output:

```json
{
  "installed": true,
  "supported": true,
  "version": "2.1.280",
  "path": "C:\\Users\\EGDev06\\AppData\\Roaming\\nvm\\v24.18.0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
  "authenticated": true
}
```

The requested `C:/Program Files/nodejs/node_modules/@anthropic-ai/claude-code/bin/claude.exe` resolves to that same canonical path through the local Node/NVM junction. A separate realpathSync comparison against resolver output returned `resolverMatches: true`. This is the fix's intentional real-path return, not discovery of a different installation. Auth output was limited to a boolean; no raw account details or secrets printed.

## Still outside this verification

Gemini sandbox include-directory mounts and Codex sandbox access outside --cd remain unproven: no live model invocation was authorized. Dependency audit findings remain. This green gate verifies engine/platform integration, not the completed dashboard: real Azure clients and optional CLI auth fallback, dashboard controllers/startup wiring, corrected UI merge and browser coverage remain pending.
