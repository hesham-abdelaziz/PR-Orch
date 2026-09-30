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
| `windows-cli-resolver.ts` | Finds `claude`, `codex`, `gemini` on `PATH` only (absolute directories, `.exe`/`.cmd`). npm `.cmd` shims are resolved to `node` + the JS entry point so no shell is needed. Codex prefers its native `.exe`. |
| `adapters/adapter-command-policy.ts` | Builds each provider's argument vector and asserts the policy (below) before every spawn. |
| `adapters/{claude,codex,gemini}.adapter.ts` | Installation/version detection, authentication probe, model catalog, `runReview`, `cancel`. |
| `model-catalog.service.ts` | `maintained` aliases, `configured` models discovered from each CLI's own config, and `dynamic` (`cli-default`). |
| `provider-registry.service.ts` | Cached statuses (TTL + coalesced refresh) behind a `ProviderSnapshotStore` port; `assertSelectable`. |
| `providers.controller.ts` | `GET /api/providers`, `POST /api/providers/refresh` (full `api/` prefix in the decorator). |
| `redact-secrets.ts` | Redaction of known secret values and common credential shapes; bounded snippets. |

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
