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

## Runtime probe sandbox gate — 2026-10-02

Checkout: `C:/Users/EGDev06/PR-Orch`, `main`, starting HEAD
`3fa76db24b5f9af35f87244af31c83552862de1b`. Codex CLI **0.159.3**,
Node **24.18.0**, Windows native PowerShell. User configuration:
`[windows] sandbox = "elevated"`. Runs began at approximately 12:22 and
12:23 Africa/Cairo. No bypass or approval escalation was used.

**Gate result: PASS for this engine/configuration and these tested operations.**
Reading checkout files and evaluating a pure mapper worked. Write attempts
inside the checkout and in a separate directory under the user's TEMP failed
with `EPERM`. HTTPS failed with `EACCES`; DNS timed out. A host-side positive
control outside the child sandbox resolved the same DNS name and fetched the
same URL with HTTP 200. npm and npx child processes could start, but their
installation writes failed with `EPERM`; neither created its lockfile/cache.

The CLI accepts `--ask-for-approval` as a global option, so the actual launch
was:

```powershell
$prompt | codex --ask-for-approval never exec --sandbox read-only --cd C:/Users/EGDev06/PR-Orch --ephemeral --json -
```

The prompt instructed the agent to execute exactly one `node -e` command
containing the UTF-8 script encoded as Base64, using its shell tool with no
escalation. A second identical sandbox launch ran the npx script. Parent-side
setup created a unique TEMP directory containing a minimal package.json and a
local npx fixture. This setup was outside the child sandbox; the child had no
permission to write those paths. Installs were offline and used only the
disposable local fixture, with no external packages.

| Check | Observed result |
| --- | --- |
| `readFileSync('package.json')` | `pr-review-orchestrator` |
| Pure in-memory mapper | `[0,7]` |
| Checkout marker write using `writeFileSync` with `flag:'wx'` | `EPERM`; marker absent on independent parent check |
| TEMP `outside-marker` write | `EPERM`; marker absent on independent parent check |
| `fetch('https://example.com')` | `fetch failed`, cause `EACCES` |
| `dns.resolve4('example.com')` | Timed out after 10 seconds |
| Unsandboxed host control | DNS resolved `172.66.147.243`, `104.20.23.154`; HTTPS 200 |
| npm offline package-lock install via `spawnSync(node, [npm-cli.js, ...])` | Exit `4294963248` (`-4048` / `EPERM`), cannot open package-lock.json; no lockfile or cache |
| npx offline local-package install via `spawnSync(node, [npx-cli.js, ...])` | Exit `4294963248`, `EPERM` creating npx-cache; no cache, fixture did not execute |

DNS timeout is an observed denial with a successful external control, not an
explicit DNS permission error. This is a bounded engine verification, not
proof for every future CLI version or sandbox configuration. Re-run the gate
after changing either. npm/npx remain forbidden by review policy even though
their attempted writes were blocked.

Raw launch events and exact scripts remain at
`C:/Users/EGDev06/AppData/Local/Temp/pr-orch-sandbox-proof-e9690a4356b04275bc9b8455b223be97/`
(`events.jsonl`, `npx-events.jsonl`, `probe.js`, `npx-probe.js`, `prompt.txt`).
Primary session: `01a0fbeb-b63d-7101-bce4-dfa234b1adf4`;
npx session: `01a0fbed-44c4-7582-8601-85d2fb445f3c`.

A repeat at approximately 12:31 Africa/Cairo preserved the primary probe's
direct completed command event, including raw `aggregated_output`, exit 0,
and status `completed`, in `repeat-events.jsonl`. Session:
`01a0fbf3-f5d5-7e41-8887-72681ce8d3d7`. All observed results matched the
table above. The exact repeat script is `proof-repeat.js`; it differs from
`probe.js` only by calling `process.exit(0)` immediately after printing results
so that the outstanding timed-out DNS operation does not keep Node alive.

### Contracts and diff-stat integration handoff for Claude

- `FindingProbeSchema` and `FindingProbe` are exported through the existing
  `src/index.ts` wildcard. Fields are exactly `summary`, `script`, `output`
  (trimmed nonempty strings; maximum lengths 300, 4000, 2000).
- `ReviewFindingSchema.probe` is optional. `ReviewerResultSchema`,
  `VerifierDecisionSchema.finding`, and `VerifiedReportSchema.findings` reuse
  that schema. Stored JSON without probe continues to parse; no migration.
- `PullRequestSummary.additions` / `.deletions` are `number | null`.
  Azure returns null because iteration metadata cannot establish line totals.
  Existing numeric summaries still parse.
- `WorkspaceService.prepare()` returns **`pullRequest: PullRequestSummary`**
  with measured additions/deletions; `metadata.json.pullRequest` contains the
  same summary. Counts use `git diff --numstat -z --no-ext-diff --no-textconv`
  between the pinned common ancestor and source. Binary `-` entries are ignored;
  excluded text contributes line totals. Renames consume both NUL-delimited
  paths. `changedFiles` keeps the existing Azure count, including binary and
  excluded files; the existing warning covers Azure/Git disagreement.
- Required in Claude-owned `reviews/review-ports.ts`: expose optional
  `PreparedWorkspace.pullRequest?: PullRequestSummary` for compatibility with
  existing port fixtures.
- Required in Claude-owned `ReviewOrchestratorService.prepareWorkspace()`:
  replace `record.pullRequest` with `prepared.pullRequest` when available and
  include that updated summary in `repository.updateJob()`, before reviewer,
  verifier and report rendering. Workspace metadata is already written with
  accurate totals; the review-job database summary still needs this wiring.
- Required in Claude-owned report renderer: omit the additions/deletions line
  whenever either total is null; print measured numbers, including real zeros,
  otherwise. Until that wiring lands, reports must not present unknown totals.

### Fresh development checks and Gemini compatibility handoff

| Command | Result |
| --- | --- |
| `npm run test:contracts` | Exit 0; 3 files, 75 tests passed. |
| `npm --workspace @pr-orchestrator/contracts run build` | Exit 0; refreshed compiled contracts consumed by API tests. |
| `npm --workspace @pr-orchestrator/contracts run lint` | Exit 0; contract typecheck passed. |
| `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.build.json --noEmit --incremental false` | Exit 0; API production typecheck passed. |
| `npm --workspace @pr-orchestrator/api test -- workspace azure-devops` | Exit 0; 6 files, 55 tests passed. |
| `npm test` | Exit 1; API 62 files, 845 passed / 4 skipped; contracts 75 passed. Web test compilation failed on nullable totals (see below). |
| `git diff --check` | Exit 0. |

The numstat fixture measured **+4 / -2 across 5 changed files**, including an
unchanged rename, modified binary, excluded lockfile, added text and edited
text. Unrelated target-only additions did not enter these totals. An
independent code review found no actionable correctness issue in the owned
changes; the Claude/Gemini integration steps below remain release dependencies.

Gemini must update `apps/web/src/app/reviews/new-review/pr-summary.component.ts`:
line 277 compares nullable totals with zero; line 65 subtracts nullable values.
Angular reports TS2531 on these expressions. Render the totals and net delta
only when both values are known. Real `0 / 0` is a measured result and should
not be treated as unavailable. No web files were edited in this handoff.

A direct API `tsc -p apps/api/tsconfig.json --noEmit --incremental false` also
failed because that config includes tests importing fixtures outside its
rootDir (TS6059) and an existing readonly DEFAULT_SETTINGS mutation in
workspace.service.spec.ts (TS2540/TS2345). The latter lines already exist at
the starting HEAD. Production typechecking uses tsconfig.build.json, which
excludes tests, and passed.

### Exact scripts evaluated

Primary parent fixture package.json: {"name":"sandbox-proof-fixture","version":"1.0.0","private":true}.

```javascript
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const dns = require('node:dns').promises;
const root = 'C:/Users/EGDev06/AppData/Local/Temp/pr-orch-sandbox-proof-e9690a4356b04275bc9b8455b223be97';
(async () => {
 const results = {};
 results.read = JSON.parse(fs.readFileSync('package.json', 'utf8')).name;
 results.eval = [null, {value: 7}].map(x => x?.value ?? 0);
 for (const [key, file] of Object.entries({writeInside: path.resolve('.sandbox-proof-marker'), writeOutside: path.join(root, 'outside-marker')})) {
  try { fs.writeFileSync(file, 'sandbox proof', {flag:'wx'}); results[key] = {blocked:false,file}; } catch(e) { results[key] = {blocked:true,code:e.code,message:e.message}; }
 }
 try { const r = await fetch('https://example.com', {signal:AbortSignal.timeout(10000)}); results.fetch = {blocked:false,status:r.status}; } catch(e) {results.fetch = {blocked:true,message:e.message,cause:e.cause?.code};}
 try { const r = await Promise.race([dns.resolve4('example.com'), new Promise((_, reject)=>setTimeout(()=>reject(new Error('timeout')),10000))]); results.dns = {blocked:false,addresses:r}; } catch(e) {results.dns = {blocked:true,code:e.code,message:e.message};}
 const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
 const r = cp.spawnSync(process.execPath, [npmCli, 'install', '--package-lock-only', '--ignore-scripts', '--offline', '--prefix', root, '--cache', path.join(root,'cache')], {encoding:'utf8',timeout:15000});
 results.npm = {status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr,packageLockWritten:fs.existsSync(path.join(root,'package-lock.json')),cacheWritten:fs.existsSync(path.join(root,'cache'))};
 console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exitCode=1});

```

The npx parent fixture was npx-fixture/package.json with name pr-orch-sandbox-npx-fixture, version 1.0.0, and bin pr-orch-sandbox-npx-fixture pointing to bin.js. That bin prints NPX_FIXTURE_EXECUTED, which did not appear.

```javascript
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process');
const root='C:/Users/EGDev06/AppData/Local/Temp/pr-orch-sandbox-proof-e9690a4356b04275bc9b8455b223be97';
const cli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');
const r=cp.spawnSync(process.execPath,[cli,'--offline','--yes','--cache',path.join(root,'npx-cache'),'--package',path.join(root,'npx-fixture'),'pr-orch-sandbox-npx-fixture'],{encoding:'utf8',timeout:20000});
console.log(JSON.stringify({status:r.status,error:r.error?.message,stdout:r.stdout,stderr:r.stderr,cacheWritten:fs.existsSync(path.join(root,'npx-cache'))}));

```
