# Provider quota backend and Gemini UI handoff

Date: 2026-09-30 (Africa/Cairo). Backend implementation only; visible dashboard
feature remains pending Gemini UI integration and browser acceptance.

## Isolation and ownership

Worktree: `C:/Users/EGDev06/.codex/worktrees/provider-quota/x20`.
Branch: `feat/provider-quota-visibility`, based on committed `4852567` of
`feat/pr-orchestrator-integration`. Integration had extensive concurrent dirty
engine, platform, contracts and Angular changes; none were copied, staged or
committed. No applicable AGENTS.md found in repository/ancestor searches.
UI checkout inspected read-only: `C:/Users/EGDev06/Documents/Codex/2026-09-29/x20`.
No other chat was messaged. Engine-owned paths were not modified.

## Verified capability matrix

| Provider / installed version | Verified source and values | Shipped behavior |
| --- | --- | --- |
| Codex 0.159.2 | Supported local `codex app-server --listen stdio://`, `initialize`, `initialized`, `account/read` with `refreshToken:false`, then `account/rateLimits/read`. Explicit `usedPercent`, `windowDurationMins`, Unix-second `resetsAt`; multiple buckets/windows supported. Installed probe returned primary 75% remaining / 300 minutes and secondary 81% / 10080 minutes. These are measurements at probe time, not guarantees. | Existing managed ChatGPT sign-in supported. Separate shared-account pools/windows, no verified model mapping. API-key/other auth unavailable; missing login unauthenticated. No earned-reset/credit actions. |
| Claude 2.1.280 | Official `/usage` interactive display includes plan limits and session statistics; `auth status` reports authentication, not remaining quota. Installed version/help/auth-status passed, authenticated boolean true, no quota/usage subcommand listed. | Explicit unavailable / unsupported_source. No TUI parsing, private OAuth endpoint or credential extraction. This is an absence of a verified supported machine-readable source for this application, not a claim that Claude cannot display usage. |
| Gemini 0.60.0 | Official interactive `/stats model` displays session token statistics and quota information. Installed version/help passed; no standalone machine-readable quota subcommand listed. Authentication not probed by starting a session. | Explicit unavailable / unsupported_source. No private Code Assist endpoints, OAuth-cache reading, interactive login or prompt-based quota probe. |

Primary sources opened during implementation:

- [OpenAI app-server protocol](https://learn.chatgpt.com/docs/app-server): initialization, account authentication modes and rate-limit field semantics. The multi-bucket view supersedes the backward-compatible single bucket. This is a CLI runtime interface, independent of desktop product tools.
- [Claude CLI reference](https://code.claude.com/docs/en/cli-reference) and [interactive command reference](https://code.claude.com/docs/en/commands): auth status is documented JSON; usage is documented as an interactive slash command.
- [Gemini command reference](https://geminicli.com/docs/reference/commands/) and [quota/pricing](https://geminicli.com/docs/resources/quota-and-pricing/): session stats and authentication-dependent quotas. Plan request ceilings alone cannot determine a user's remaining percentage.

Subscription/account limits differ from API billing credits, local session tokens,
application token totals and model-specific allocations. Unknown is null, never
zero. Unlimited credits do not imply 100% quota. No paid calls, threads, turns,
reviews, purchases, Azure operations or reviewed-repository writes were invoked.

## API contract

Additive exports from `@pr-orchestrator/contracts`: `QuotaWindowSchema`,
`ProviderQuotaSchema`, `ProviderQuotasResponseSchema` and associated types.
Existing `ProviderStatusSchema`, model selections and review requests are unchanged.

| Method / endpoint | Behavior |
| --- | --- |
| GET `/api/provider-quotas` | 200 `ProviderQuotasResponse`; lazy read, 60-second in-memory cache |
| POST `/api/provider-quotas/refresh` | 200 same response; no body needed; explicit refresh after cooldown |

Both use existing global session guard, loopback Host/Origin policy and
same-origin HttpOnly cookie. Unauthenticated dashboard access returns 401 before
probing. Provider login failure is a provider state inside HTTP 200, never a
dashboard-session 401. Production bootstrap adds existing no-store HTTP headers.

Example provider entry (illustrative; dynamic timestamps and values):

```json
{
  "provider": "codex",
  "scope": "account",
  "status": "available",
  "reason": null,
  "source": "codex_app_server",
  "message": null,
  "windows": [
    {"poolId":"codex","window":"primary","scope":"shared_pool","model":null,"remainingPercent":75,"windowDurationMins":300,"resetAt":"2026-10-01T01:18:44.000Z"},
    {"poolId":"codex","window":"secondary","scope":"shared_pool","model":null,"remainingPercent":81,"windowDurationMins":10080,"resetAt":"2026-10-07T10:33:08.000Z"}
  ],
  "lastUpdatedAt": "2026-09-30T20:51:00.000Z",
  "checkedAt": "2026-09-30T20:51:00.000Z",
  "expiresAt": "2026-09-30T20:52:00.000Z"
}
```

Response envelope: `{providers:[codex,claude,gemini],cacheTtlSeconds:60,
refreshCooldownSeconds:15,nextRefreshAt:ISO_UTC}`. All three entries always exist;
each provider fails independently. Claude/Gemini have `scope:account`,
`source:none`, `status:unavailable`, `reason:unsupported_source`, `windows:[]`,
`lastUpdatedAt:null` and a concise static explanation.

Window fields: `remainingPercent:number|null` bounded 0–100; `resetAt:ISO_UTC|null`;
`windowDurationMins:positive integer|null`. `primary`/`secondary` are source slot
names, not hardcoded daily/weekly promises; derive a displayed duration from the
reported minutes. `poolId:codex|pool-N` distinguishes source pools. Unknown upstream
identifiers/names are replaced with ordinal pool labels to prevent account data
leaking. Ordinal labels are local to a response; do not persist a model mapping or
cross-response identity for them. `scope:shared_pool`, `model:null` on every window
is intentional. No current adapter verifies model-specific allocations.

`lastUpdatedAt` is a successful measurement time; `checkedAt` is the last read
attempt; `expiresAt` is the next automatic read eligibility, anchored at completed
refresh plus 60 seconds. `available` means at least one window has a numeric
percentage; other windows may still be null. Every failed refresh clears previous
measurements: account continuity cannot be verified after a failed read, and old
percentages could belong to a different CLI account. Failures return `error`, no
windows, `lastUpdatedAt:null`. Known unauthenticated and unsupported sources also
clear measurements. `stale` is supported in the additive status schema; the current
adapters do not return historical values as stale after failure. Gemini should
mark displayed snapshots stale locally when their freshness expires, and clear
them upon a new failure response. Missing/invalid numeric values never
become percentages; unsupported response shapes fail safely.

Repeated explicit refresh inside 15 seconds returns 429 with
`{message,retryAfterSeconds}`. Cooldown starts on every actual read attempt,
including GET cache misses. Concurrent GET/POST requests join one refresh; no
additional process is spawned. No timers/polling/background refresh run in the
backend. Cache is memory-only and disappears on shutdown; no raw provider output,
account identifiers, plan names, keys, cookies, tokens or errors are stored.

## Angular integration for Gemini

Current read-only integration points:

- `apps/web/src/app/core/api/api-client.service.ts`: existing `request` already
  validates Zod DTOs, sends same-origin cookies and handles dashboard 401.
- `apps/web/src/app/providers/providers.store.ts`: keep the provider discovery
  state separate from quota state; add an independent quota store or signals.
- `apps/web/src/app/providers/provider-status-card.component.ts` and
  `apps/web/src/app/settings/provider-settings.component.ts`: provider windows,
  status, reset/freshness and refresh action.
- `apps/web/src/app/reviews/new-review/main-model-selector.component.ts`,
  `reviewer-selector.component.ts`, and `new-review-page.component.ts`: show
  quota beside selections by joining on provider, with shared quota labeling.
- `apps/web/src/app/settings/review-defaults.component.ts`: same labeling beside
  configured model choices. Reconfirm current files after concurrent UI work.

Use the actual schema, for example:

```typescript
const quota = await apiClient.request({
  method: 'GET', path: '/api/provider-quotas',
  schema: ProviderQuotasResponseSchema,
});
// Explicit user refresh uses POST /api/provider-quotas/refresh with same schema.
```

Load quota independently after login/page entry. A quota request failure must not
clear provider catalogs, reset selections, reject review creation or disable the
start button. Do not make review start await quota. Reusing Codex for main and
reviewers still uses one shared pool, not separate allocations. Display e.g.
“Codex shared account quota — 5h: 75% remaining; 7d: 81% remaining” using actual
durations; never average or sum windows/pools. Zero is an actual measured depleted
window; null displays “Unavailable”, not an empty/zero progress bar. Do not imply
unknown extra pools apply to a selected model; list them at provider level.

Show reset times and last successful update in local user time; source timestamps
are UTC. Show cached/fresh versus stale explicitly. If data is left on screen past
`expiresAt`, mark it out of date locally until another successful GET/refresh;
after a window reset passes, do not present the old percentage as live. Keep
locally stale data visibly qualified until a response arrives; clear previous
values on provider error/unauthenticated/unavailable. No auto retry loop. Permit refresh only after
`nextRefreshAt`, disable it while in flight, respect 429's retryAfterSeconds.
Manual/page-entry refresh is sufficient; any optional visible-page polling must
be at least 60 seconds and stop on navigation/logout. Clear quota state on logout.

For `unauthenticated`, guide existing CLI login outside the dashboard; do not
implement credential prompts. For `error`, show sanitized explanation and retry.
For unavailable Claude/Gemini, explain unsupported machine-readable source; do not
promise future live percentages. No fake 0%, 100%, aggregate percentage or quota
blocking of reviews. Test multiple/null windows, stale/reset expiry, partial
failure, 401, 429, shared labels and preserved review selections/start behavior.

## Safe integration

After the integration owner has reconciled/committed ongoing work, cherry-pick
the quota implementation commit from this branch in a clean integration checkout.
Do not merge/move active branches or stage another task's dirty files. Reconcile
the additive `packages/contracts/src/index.ts` export and `AppModule` import by
keeping newer changes and adding quota. `providers.ts` is not modified, so current
reasoning-effort/provider work need not be replaced. Rebuild contracts before API
and Angular. No database migration or new dependency is required.

Backend has no required engine edits. A future engine supervisor capable of
interactive stdin/JSON-RPC could replace the platform transport, but is not needed
to integrate this implementation. Current code imports the existing validated
CLI resolver, restricted environment policy and process-tree killer without
modifying engine-owned paths. Transport is shell:false, absolute regular-file
executable only, temp cwd, 15s timeout, 256 KiB stdout/16 KiB discarded stderr caps,
4s cleanup bound and shutdown cancellation. No raw output is logged; static
diagnostics plus numeric projection provide redaction by construction. Process
tree termination is best effort, not a Windows Job Object security boundary.

Installed-provider probe: `node scripts/smoke-provider-quotas.mjs` after contracts
and API build. It prints only versions/capabilities, a Claude auth boolean and
sanitized numeric Codex quota. It never prints auth/account payloads. The CLI may
use its own managed authentication lifecycle for the supported read; the app
does not read credentials, request token refresh or mutate login/configuration.

Fresh gate results are recorded in `provider-quota-verification.md`.
