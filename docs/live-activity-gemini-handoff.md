# Gemini handoff — V1 live run activity: active-review UI

Repository: `C:\Users\EGDev06\PR-Orch`, branch `feat/live-run-activity`.
You own `apps/web/**` only. Don't edit `packages/contracts`, `apps/api` or `tests/fixtures`. If the contract seems wrong, report it instead of working around it.

## Goal

While a review runs, each reviewer card and a **new main-verifier card** show what that model is visibly doing and how recently it happened. Updates arrive without a refresh, survive a refresh/reconnect, and stay viewable on finished reviews.

## What the backend provides (already implemented and tested)

Types live in `@pr-orchestrator/contracts` (`packages/contracts/src/activity.ts` and `reviews.ts`). Import them; don't redefine them.

### Snapshot (`GET /api/reviews/:id`, SSE `job.snapshot`)

- `ReviewJob.verifier?: ReviewerRun` is the main verifier run, with the same shape as a reviewer run. It is absent only for malformed or very old data.
- `ReviewerRun.activity?: RunActivitySummary` appears on every run of the full snapshot (not on history rows):
  - `visibility`: one of
    - `'full'`: file/tool activity (Claude, Gemini)
    - `'partial'`: action kinds only; Codex shows "running a command" but never which file
    - `'heartbeat_only'`: CLI cannot stream, so only liveness
    - `null`: process not started yet, **or a review recorded before this feature**
  - `recent: RunActivity[]`: newest ≤ 50 entries, oldest first.
  - `current: RunActivity | null`: newest `provider`-kind entry.
  - `lastActivityAt`: time of the newest *provider* entry. Heartbeats never move it.
  - `lastHeartbeatAt`: last process heartbeat; non-null only while the run is `running`.
  - `total`: entries ever recorded. More than `recent.length` means older entries exist.

`RunActivity` fields:

| Field | Values |
| --- | --- |
| `id` | `${runId}:${seq}` |
| `seq`, `at` | per-run sequence number and timestamp |
| `kind` | `provider` \| `lifecycle` \| `notice` |
| `action` | provider: `reading_file`, `searching`, `listing_files`, `running_command`, `thinking`, `writing_answer`, `tool_other` · lifecycle: `attempt_started`, `process_started`, `attempt_ended` · notice: `events_skipped` |
| `attempt?` | 1 = first try, 2 = correction retry |
| `tool?` | e.g. `Read`, `read_file`, `shell` |
| `target?` | `{ path, startLine?, endLine? }`, a repo-relative path |
| `outcome?` | `attempt_ended` only: `completed`, `invalid_output`, `failed`, `timed_out`, `cancelled` |
| `count?` | `events_skipped` only |

### Live SSE events (same `EventSource`, unnamed messages)

| Event | Payload | Handling |
| --- | --- | --- |
| `run.activity` | `{ runId, role, activity, visibility, total, lastActivityAt }` | Append `activity` to that run's log **if its `id` is not already present**, then set `visibility`, `total`, `lastActivityAt`. If `activity.kind === 'provider'`, also set `current`. |
| `run.heartbeat` | `{ runId, role, at }` | Set only `lastHeartbeatAt`. Never touch `lastActivityAt` or the log. |
| `reviewer.state_changed` | now also emitted for the verifier (`role: 'verifier'`); optional `startedAt`/`completedAt` | Match the run by `runId` in `reviewers` **or** `verifier`, and update state plus the times when present. When the state leaves `running`, clear `lastHeartbeatAt`. |

**De-duplication is required.** An entry stored just before a snapshot can also arrive as a live event after it. Key log entries by `id`, keep them sorted by `seq`, and never render duplicates. A new `job.snapshot` (after a reconnect) replaces the per-run summaries; then merge any later live events into them.

### Full log (expand)

`GET /api/reviews/:reviewId/runs/:runId/activity` returns `RunActivityLog { runId, items (≤ 200, oldest first), total }`. Validate it with `RunActivityLogSchema` through the existing `ApiClientService`. Fetch it when the user expands a log whose `total > recent.length`, and merge by `id` with what you already have.

## UI requirements

1. **Compact activity summary** on each reviewer card and on a verifier card that uses the same component. Show:
   - The model identity and execution state badge (existing).
   - The current action as fixed text, built from `action` + `target` (examples below). Never invent detail.
   - The target as `path:start–end` (or `path:start`, or just `path`) when present.
   - Elapsed time: `now − startedAt` while running, frozen at `completedAt − startedAt` when finished. Show nothing before start.
   - A separate activity-age line:
     - `Last activity 12s ago` when `lastActivityAt` is set.
     - `No activity update for 2m 10s` when it's older than ~30 s while running. This is **neutral styling, not an error**: a quiet provider is not failed or stalled. Never change the state badge because of it.
   - Heartbeat while running: e.g. `Process alive · checked 5s ago` from `lastHeartbeatAt`, visually distinct from real activity (secondary/muted text, no file or action detail).
   - A visibility hint:
     - `partial`: "Limited visibility: commands only, no file details"
     - `heartbeat_only`: "Limited visibility: liveness only"
     - `null` on a finished run with `total === 0`: "No activity recorded" (older reviews)

   Suggested action labels:

   | Action | Label |
   | --- | --- |
   | `reading_file` | Reading file |
   | `searching` | Searching |
   | `listing_files` | Listing files |
   | `running_command` | Running a read-only command |
   | `thinking` | Reasoning |
   | `writing_answer` | Writing the answer |
   | `tool_other` | Using a tool (append `tool` if present) |
   | `attempt_started` | Attempt N started (attempt 2 = "Correction attempt started") |
   | `process_started` | Provider process started |
   | `attempt_ended` | Attempt N ended: {outcome} |
   | `events_skipped` | N unreadable progress events ignored |

2. **Expandable, timestamped activity log** per model, collapsed by default and keyboard/screen-reader accessible (existing a11y patterns). Each row shows a local time (`HH:mm:ss`), the label and the target. Visually separate lifecycle and notice rows from provider rows.
   - Show at most 200 rows (the backend retention). When `total` exceeds what's loaded, say "Showing the latest N of M events".
   - Don't auto-scroll while the user has scrolled up.
3. **Live clock:** one shared 1 s ticker (e.g. a signal) drives every age and elapsed label. No per-card intervals, and stop it when the page is destroyed.
4. **Terminal states:**
   - Completed, failed, timed-out and cancelled runs keep their log and summary, show final elapsed time, and show no heartbeat and no "no activity for" warning.
   - A verifier that never ran (job failed or cancelled earlier, or zero candidates) keeps today's "Not run" handling, with an empty log.
5. **Sanitization:** render every text as plain text through Angular interpolation. No `innerHTML`, and don't build links from paths.

## Files you'll likely touch

- `apps/web/src/app/reviews/active-review/active-review.store.ts`: handle the new events, de-duplicate, keep verifier state, and add the 1 s clock signal.
- `apps/web/src/app/reviews/active-review/reviewer-run-card.component.ts`: summary and log, also used for the verifier.
- `apps/web/src/app/reviews/active-review/active-review-page.component.ts`: render the verifier card.
- A new small presentational component for the log, if that keeps the card readable.
- Specs next to each file.

## Tests to add (Angular/Vitest, existing patterns)

- **Store:**
  - snapshot with activity, then `run.activity` (including a duplicate `id`): no duplicate rows.
  - `run.heartbeat` updates only `lastHeartbeatAt`.
  - a verifier `reviewer.state_changed` updates `job.verifier`.
  - a reconnect snapshot replaces summaries.
  - legacy jobs without `verifier`/`activity` still render.
- **Card:**
  - each visibility hint.
  - target formatting with and without lines.
  - elapsed time frozen after completion.
  - "No activity update for …" appears only while running and past the threshold, and never changes the badge.
  - "No activity recorded" for legacy runs.
  - log expand fetches the full log once when `total > recent.length`.
- **Accessibility:** extend `accessibility.spec.ts` for the expand control.

## Validation

```
npm --workspace @pr-orchestrator/contracts run build
npm --workspace @pr-orchestrator/web run build
npm --workspace @pr-orchestrator/web test
```

The app runtime is stopped: don't start it, run paid reviews, commit or push unless the user asks.
