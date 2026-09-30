# Provider quota implementation plan

Goal: authenticated, honest quota visibility without paid calls or review gating.

Architecture: additive contracts in quota.ts; platform-owned module under
apps/api/src/platform/quota. Codex app-server uses its existing managed login,
initialize/initialized, account/read (refreshToken:false), account/rateLimits/read.
No thread, turn, login, token-file access, browser scraping or reset-credit calls.
Claude/Gemini remain unavailable: interactive usage displays are not a verified
machine-readable runtime API. UI remains Gemini-owned and needs a handoff.

Isolation: separate feat/provider-quota-visibility from committed 4852567;
concurrent dirty integration changes are deliberately excluded. Native worktree
tool cannot target this external unregistered repository from a projectless chat,
so use git worktree fallback. No applicable AGENTS.md found in project/ancestors.
The detailed task authorizes implementation and specifies its constraints; execute
inline without introducing an additional approval stage or messaging other chats.

1. Verify official docs and installed versions/help. Probe only supported reads.
2. Tests first: nullable percentages, windows, scope, sanitized allowlisted data.
   Add quota.ts and export it without changing existing provider schemas.
3. Tests first: bounded JSON-RPC transport with validated absolute executable,
   filtered environment, no raw stderr retention, output caps, timeout/shutdown
   cancellation, shared existing process-tree killer. Never invoke model methods.
4. Tests first: independent sources, TTL 60 seconds, forced refresh cooldown 15
   seconds, in-flight deduplication. Null lastUpdatedAt when no successful
   measurement exists. Ruling after review: clear all prior quota on failed read
   because current CLI account continuity is unverified; locally displayed stale
   state is a frontend freshness concern. Anchor cache TTL at read completion.
5. Wire authenticated GET /api/provider-quotas and POST /api/provider-quotas/refresh
   into AppModule. HTTP access tests and existing fake review regression gates.
6. Document source capability matrix, exact DTOs, UI integration points, examples,
   refresh/freshness rules, unavailable states and safe cherry-pick guidance.
7. Run full tests/lint/build/e2e, read-only installed probes, diff review, commit
   only task-owned paths. Preserve branch/worktree; no merge/push/deploy.

Review focus: invalid/out-of-range measurements stay null; multi-bucket view must
not duplicate legacy pool; unknown pool IDs must not leak account information;
logout/auth failures must not reuse previous-account quota; process response
flood/malformed response/exit/cancel must terminate and never log raw payloads.
