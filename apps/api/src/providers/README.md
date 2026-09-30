# Provider engine (`apps/api/src/providers`)

Runs the local Claude, Codex and Gemini CLIs as **read-only reviewers** under
tight process supervision. Owned by the engine stream; consumed by
`reviews/` through `ProviderAdapter` and `ProviderRegistryService`.

## Layout

| Path | Responsibility |
| --- | --- |
| `process/process-supervisor.service.ts` | Spawns one child (`shell: false`, absolute executable, argument array), writes the prompt to **stdin**, drains stdout and stderr independently with separate byte caps, enforces timeout and cancellation, returns `completed / failed / timed_out / cancelled`. |
| `process/process-tree-killer.ts` | Idempotent tree termination: POSIX process group, Windows `taskkill /PID <pid> /T` then `/F` after a grace period. The runner is injectable for tests. |
| `process/environment-policy.ts` | Deny-by-default child environment: a small system allowlist plus a per-provider auth allowlist. Names containing `AZURE`, `PASSWORD`, `SECRET`, `SESSION`, a `PAT` segment or `PR_ORCHESTRATOR*` are never passed. `TOKEN`-like names pass only when allow-listed for that provider. |
| `process/output-buffer.ts` | Byte-capped, UTF-8-boundary-safe buffer; strips ANSI and control characters. |
| `windows-cli-resolver.ts` | Finds `claude`, `codex`, `gemini` on `PATH` only (absolute directories, `.exe`/`.cmd`). npm `.cmd` shims are parsed, never run: a JavaScript target becomes `node` + the entry point; a native `.exe` target (Claude Code's npm package) is run directly under the containment rule below. Codex prefers a native `.exe`. |
| `adapters/adapter-command-policy.ts` | Builds each provider's argument vector and asserts the policy (below) before every spawn. |
| `adapters/{claude,codex,gemini}.adapter.ts` | Installation/version detection, authentication probe, model catalog, `runReview`, `cancel`. |
| `model-catalog.service.ts` | `maintained` aliases, `configured` models discovered from each CLI's own config, and `dynamic` (`cli-default`). |
| `provider-registry.service.ts` | Cached statuses (TTL + coalesced refresh) behind a `ProviderSnapshotStore` port; `assertSelectable`. |
| `providers.controller.ts` | `GET /api/providers`, `POST /api/providers/refresh` (full `api/` prefix in the decorator). |
| `redact-secrets.ts` | Redaction of known secret values and common credential shapes; bounded snippets. |

## Windows npm shim resolution

`.cmd` wrappers are read as text and never executed through `cmd.exe`. The
last `"%dp0%\<relative target>" %*` launch line decides the target:

- **JavaScript** (`.js`, `.cjs`, `.mjs`): must lie inside the shim directory
  (no `.`/`..` segments) and exist; runs as `<current node.exe> <entry> …`.
- **Native** (`.exe`), e.g. Claude Code 2.1.280's
  `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*`:
  runs as the executable itself with no Node prefix, and only when all hold:
  - the relative target has no empty, `.`, `..` or `:`-bearing segment
    (rejects traversal, UNC, drive-qualified and alternate-data-stream forms);
  - it names `node_modules\<package>\…` or `node_modules\@scope\<package>\…`
    with at least one segment below the package directory;
  - neither the shim directory nor the target's real path is a UNC path;
  - after resolving every junction and link, the target's real path starts
    with `<real shim dir>\node_modules\<package>\` (case-insensitive);
    a package directory or file linked elsewhere is refused;
  - the real path is an existing regular file.
  The returned `executablePath` is that real path.

Anything else (other extensions, absolute targets, a missing file) makes the
shim unresolvable, so the provider reports as not installed.

## Command profiles

Prompts are **never** on the command line; a policy check rejects any argv that
contains prompt text. Model ids are validated (`[A-Za-z0-9][A-Za-z0-9._:/-]*`)
before they reach argv. `cli-default` omits `--model`.

| Provider | Arguments (before an optional `--model <id>`) |
| --- | --- |
| Claude | `-p --output-format json --json-schema <inline> --permission-mode plan --permission-prompts none --restricted --tools Read,Grep,Glob --disallowedTools Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,mcp__* --strict-mcp-config --disable-slash-commands --no-session-persistence [--add-dir <context dir>]…` |
| Codex | `--ask-for-approval never exec --sandbox read-only --ephemeral --skip-git-repo-check --color never --output-schema <file> --cd <workspace> [--model <id>] -` |
| Gemini | `--approval-mode plan --output-format json [--sandbox] [--include-directories <dir,dir>] [--model <id>]` (prompt on stdin; `--sandbox` only when Docker/Podman is on `PATH`) |

The process cwd is always the checkout root (`ProviderRunRequest.workspacePath`). `readOnlyDirectories` lists absolute directories outside it that hold context files. `--add-dir` is forbidden for Codex by the command policy because it grants write access there.

Write-capable, YOLO, auto-edit and unrestricted modes are absent and asserted
absent by `adapter-contract.spec.ts`.

## Assumptions about the installed CLIs

These were checked against each vendor's published CLI reference while
building this stream; they must be re-confirmed on the target Windows machine.

- **Claude Code ≥ 2.1.259** (the minimum is enforced; older versions are shown as unavailable with an update hint). Uses `claude -p`, `--json-schema`, `--permission-mode plan`, `--permission-prompts none`, `--restricted`, `--tools`, `--disallowedTools`. The answer is read from the JSON envelope (`structured_output`, else the `result` text).
- **Codex**: `codex --ask-for-approval never exec --sandbox read-only --output-schema`. The final answer is taken from the last result/agent message in the output (JSONL events, plain text, fenced JSON or a balanced `{…}` object), then validated once.
- **Gemini CLI**: `--approval-mode plan`, `--output-format json`; the answer is read from the JSON envelope's `response` field. `--model auto` is accepted as a model value only; the approval mode is always `plan`.
- Authentication is detected from each CLI's existing login or documented API-key variables; a definitive answer may only appear at run time (`unknown_until_run`).
- Models offered as *maintained* aliases are a convenience list; `cli-default` always works and is the recommended default.

## Failure model

Adapters never throw for expected problems. `ProviderRunResult` is
`completed | failed | timed_out | cancelled`; failures carry a `kind`
(`not_installed`, `unsupported`, `invalid_request`, `authentication`,
`model_unavailable`, `output_truncated`, `process`) and an actionable,
redacted, bounded `message`. Diagnostics never include the prompt or a full
transcript.

## Tests and fakes

`tests/fixtures/fake-clis/windows-npm-shims.ts` holds synthetic copies of the
npm `.cmd` wrapper shapes. Real-filesystem resolver tests (regular file,
directory, junction, file symlink) run only on Windows; the file-symlink case
skips when the process lacks the Windows symlink privilege.

`tests/fixtures/fake-clis/` holds deterministic fake CLIs (`fake-cli.mjs` for
supervisor scenarios, `fake-provider.mjs` for adapter contract tests) and the
orchestrator harness. No test calls a real, paid provider.

Run: `npm --workspace @pr-orchestrator/api test -- providers`.

## Extending

A new provider needs: an adapter extending `BaseCliAdapter`, a command builder
in `adapter-command-policy.ts` with its policy assertions, an auth allowlist in
`environment-policy.ts`, a registration in `providers.module.ts`, and an
addition to `adapter-contract.spec.ts`. The `ProviderId` union lives in the
shared contracts and must be extended there first.
