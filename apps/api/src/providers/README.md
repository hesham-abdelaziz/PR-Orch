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
| Claude | `-p --output-format stream-json --verbose --json-schema <inline> --permission-mode plan --permission-prompts none --restricted --tools Read,Grep,Glob --disallowedTools Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,mcp__* --strict-mcp-config --disable-slash-commands --no-session-persistence [--add-dir <context dir>]…` |
| Codex | `--ask-for-approval never exec --sandbox read-only --ephemeral --skip-git-repo-check --color never [--json] --output-schema <file> --cd <workspace> [--model <id>] -` |
| Gemini | `--approval-mode plan --output-format stream-json\|json [--sandbox] [--include-directories <dir,dir>] [--model <id>]` (prompt on stdin; `--sandbox` only when Docker/Podman is on `PATH`) |

The process cwd is always the checkout root (`ProviderRunRequest.workspacePath`). `readOnlyDirectories` lists absolute directories outside it that hold context files. `--add-dir` is forbidden for Codex by the command policy because it grants write access there.

Write-capable, YOLO, auto-edit and unrestricted modes are absent and asserted
absent by `adapter-contract.spec.ts`.

## Live activity (structured streams)

Each run streams the CLI's structured events so the engine can show what the
model is doing. `process/process-supervisor.service.ts` hands every raw stdout
chunk to an optional `onStdout` observer; `activity/json-line-splitter.ts` cuts
it into lines on the raw `\n` byte (UTF-8 safe across chunks) with a per-line
cap of `min(24 MiB, 2 × maxStdoutBytes + 64 KiB)`; a longer line is dropped
whole without being buffered. A per-provider decoder (`activity/*-stream.decoder.ts`)
reads allowlisted fields only and retains just the final answer, which then goes
through the unchanged parser, truncation and failure classification.

| Provider | Stream | Visibility | Observable |
| --- | --- | --- | --- |
| Claude | always (`stream-json` predates the minimum version) | `full` | `Read` (path + `offset`/`limit` lines), `Grep`/`Glob` (scope path only, never the pattern), thinking/answer *events* (never their text). The final `result` event is the old JSON envelope. |
| Gemini | when `gemini --help` lists `stream-json` | `full` | `read_file` (path + 0-based `offset` → 1-based lines), `search_file_content`/`grep_search`/`glob`/`list_directory` (scope path), answer events. Assistant deltas are reassembled into `{"response": …}`; an error result adds `error.message`. |
| Codex | when `codex exec --help` lists `--json` | `partial` | reasoning, shell command, web search and agent-message *kinds*. Command text, output and any paths are never read: Codex reads files through shell commands, so no file target is shown. The final answer is the last completed agent message, as plain `exec` printed. |
| any | CLI without the stream option | `heartbeat_only` | liveness only; the old final-envelope format is used. |

`activity/activity-observation.ts` keeps a path only if it normalizes (via the
finding path validator) to a checkout-relative path that redaction leaves
unchanged; context files outside the checkout, traversal, UNC, URLs and drive
paths are dropped, and line numbers survive only with a kept path. Tool names
must match `^[A-Za-z][A-Za-z0-9_.-]{0,63}$`. Prompts, model text (thinking,
answers), tool results, search patterns and command arguments never leave the
decoder. Malformed, non-object and oversized lines are counted and reported once
per attempt as `skipped(n)`; they never fail a run. In streaming mode the raw
stdout buffer is only 4 KiB (diagnostics only), so tool output such as file
contents is not held in memory; the answer itself is capped at `maxStdoutBytes`
(over the cap → `output_truncated`, as before). Sink callbacks are guarded and
can never affect a run.

## Assumptions about the installed CLIs

These were checked against each vendor's published CLI reference while
building this stream; they must be re-confirmed on the target Windows machine.

- **Claude Code ≥ 2.1.259** (the minimum is enforced; older versions are shown as unavailable with an update hint). Uses `claude -p --output-format stream-json --verbose` (checked against 2.1.286's `--help`), `--json-schema`, `--permission-mode plan`, `--permission-prompts none`, `--restricted`, `--tools`, `--disallowedTools`. The answer is read from the final `result` event (`structured_output`, else the `result` text).
- **Codex**: `codex --ask-for-approval never exec --sandbox read-only --output-schema`, plus `--json` when offered (0.159.3 does). Event names (`item.started`/`item.completed`, `command_execution`, `agent_message`, `reasoning`, `turn.failed`, `error`) follow the documented `exec --json` stream. The final answer is taken from the last result/agent message in the output (JSONL events, plain text, fenced JSON or a balanced `{…}` object), then validated once.
- **Gemini CLI**: `--approval-mode plan`, `--output-format stream-json` when offered (0.60.0 does), else `json`; the answer is the reassembled `response`. Tool parameter names (`file_path`/`absolute_path`, `offset`, `limit`, `path`/`dir_path`) and the 0-based `offset` follow the CLI's built-in tool schemas. The stream shapes of all three CLIs were checked against `--help` and documentation only: no paid run was made, so confirm them with one opt-in smoke review per provider. `--model auto` is accepted as a model value only; the approval mode is always `plan`.
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
