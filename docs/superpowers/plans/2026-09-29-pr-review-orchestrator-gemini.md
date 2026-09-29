# PR Review Orchestrator Gemini Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete Angular dashboard from the approved Stitch visual direction and shared backend contracts.

**Architecture:** The Angular application uses standalone components, lazy routes, signals for local view state, a typed API client, and an SSE review-event client. Feature folders own their pages and state facades; shared visual primitives implement the Stitch-inspired dark developer-tool system without shipping generated HTML, remote assets, or CDN scripts.

**Tech Stack:** Angular 22, Angular Material/CDK, SCSS design tokens, RxJS, signals, `marked`, DOMPurify, Vitest, Angular Testing Library, Playwright/axe for final accessibility integration.

**Spec:** `docs/superpowers/specs/2026-09-29-pr-review-orchestrator-design.md`

## Global Constraints

- Start only from the Codex Task 1 contract-gate commit.
- Edit only `apps/web/**`.
- Consume DTOs from `@pr-orchestrator/contracts`; do not duplicate server models.
- Treat the Stitch export as a visual reference only. Do not copy its Tailwind CDN, inline scripts, remote logo, sample credentials, fake telemetry, or unsupported actions.
- Dark theme only for the MVP; desktop layout supports widths from 1024 pixels upward.
- No patch, approval, Azure comment, commit, push, replay, PDF export, or arbitrary terminal action.
- No numeric confidence, consensus, or risk scores.
- Every loading, empty, warning, failure, cancellation, and partial-success state is explicit.
- All forms preserve valid input after recoverable errors.
- Raw model Markdown and HTML are untrusted.

## Review Focus

- A long repository name, PR title, model name, or file path must wrap/truncate without hiding its full accessible name; Tasks 1, 3, and 5.
- SSE disconnect/reconnect must not duplicate events or regress displayed job state; Task 4.
- Missing standards and partial reviewer failure warnings must remain visible in the final report; Tasks 3 and 5.
- Markdown with raw HTML, JavaScript links, huge code blocks, or malformed tables must remain safe and usable; Task 5.
- Keyboard-only use at 1024-pixel width must reach every action with visible focus and no trapped overlay; Tasks 1 and 5.

---

### Task 1: Angular shell, design system, authentication, and typed client

**Files:**
- Modify: `apps/web/src/styles.scss`
- Create: `apps/web/src/styles/_tokens.scss`
- Create: `apps/web/src/styles/_mixins.scss`
- Create: `apps/web/src/app/core/api/api-client.service.ts`
- Create: `apps/web/src/app/core/api/api-error.ts`
- Create: `apps/web/src/app/core/auth/auth.store.ts`
- Create: `apps/web/src/app/core/auth/auth.guard.ts`
- Create: `apps/web/src/app/core/auth/signed-out.guard.ts`
- Create: `apps/web/src/app/layout/app-shell.component.ts`
- Create: `apps/web/src/app/layout/sidebar.component.ts`
- Create: `apps/web/src/app/layout/top-status-bar.component.ts`
- Create: `apps/web/src/app/auth/setup-page.component.ts`
- Create: `apps/web/src/app/auth/login-page.component.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/app.config.ts`
- Test: `apps/web/src/app/auth/auth-pages.spec.ts`
- Test: `apps/web/src/app/layout/app-shell.spec.ts`
- Test: `apps/web/src/app/core/api/api-client.service.spec.ts`

**Interfaces:**
- Consumes: Auth schemas and locked routes from `@pr-orchestrator/contracts`.
- Produces: `ApiClientService.request<TSchema>(method, path, schema, options)`, authenticated route guards, and reusable shell/status components.

- [ ] **Step 1: Write failing authentication and shell tests**

Cover first-run setup, existing-user login, invalid credentials, session restore, logout, protected-route redirect, keyboard navigation, 1024-pixel shell layout, provider/standards status placeholders, and read-only banner.

- [ ] **Step 2: Write failing API-client tests**

Assert same-origin credentials, shared-schema response parsing, normalized API errors, 401 session invalidation, and rejection of malformed server payloads.

- [ ] **Step 3: Run tests to verify failure**

Run: `npm --workspace apps/web test -- auth app-shell api-client`

Expected: FAIL because pages, guards, and typed client are missing.

- [ ] **Step 4: Implement the visual tokens and shell**

Translate the approved Stitch palette, Inter/JetBrains Mono typography, compact spacing, borders, severity colors, focus rings, and provider accents into local SCSS tokens. Use local/system fonts with no remote font request.

- [ ] **Step 5: Implement setup/login/session flows**

Use reactive forms, accessible validation messages, disabled submit during requests, server-error preservation, and session restoration before guarded routing.

- [ ] **Step 6: Implement the typed API client**

Validate every JSON response through its shared Zod schema and map backend error codes to concise user-facing messages without exposing raw stack traces.

- [ ] **Step 7: Run shell/auth tests**

Run: `npm --workspace apps/web test -- auth app-shell api-client`

Expected: PASS.

- [ ] **Step 8: Commit the Angular foundation**

```bash
git add apps/web
git commit -m "feat: add orchestrator Angular shell"
```

### Task 2: Settings, standards, and provider configuration

**Files:**
- Create: `apps/web/src/app/settings/settings-page.component.ts`
- Create: `apps/web/src/app/settings/account-settings.component.ts`
- Create: `apps/web/src/app/settings/azure-auth-settings.component.ts`
- Create: `apps/web/src/app/settings/provider-settings.component.ts`
- Create: `apps/web/src/app/settings/review-defaults.component.ts`
- Create: `apps/web/src/app/standards/standards-page.component.ts`
- Create: `apps/web/src/app/standards/standards-upload.component.ts`
- Create: `apps/web/src/app/standards/standards-preview.component.ts`
- Create: `apps/web/src/app/providers/provider-status-card.component.ts`
- Create: `apps/web/src/app/providers/providers.store.ts`
- Test: `apps/web/src/app/settings/settings-page.spec.ts`
- Test: `apps/web/src/app/standards/standards-page.spec.ts`
- Test: `apps/web/src/app/providers/providers.store.spec.ts`

**Interfaces:**
- Consumes: Settings, standards, and provider schemas/routes from the contract package.
- Produces: Settings/standards pages and `ProvidersStore.refresh/selectableModels/providerStatus` signals used by New Review.

- [ ] **Step 1: Write failing configuration tests**

Cover PAT configured/unconfigured states without revealing a secret, Azure CLI fallback, connection-test results, provider installed/authenticated/unknown states, dynamic versus maintained model catalogs, default model validation, and save-error preservation.

- [ ] **Step 2: Write failing standards tests**

Cover no-file warning, `.md` replacement, filename/size validation, hash and upload metadata, safe content preview, replacement confirmation, and historical-version explanation.

- [ ] **Step 3: Run tests to verify failure**

Run: `npm --workspace apps/web test -- settings standards providers`

Expected: FAIL because the feature components do not exist.

- [ ] **Step 4: Implement settings sections**

Use route-level page composition and focused child components. Distinguish installed, authenticated, unknown-until-run, unavailable, and stale catalog states with text plus color.

- [ ] **Step 5: Implement standards management**

Use a file picker restricted in the UI to text/Markdown while trusting server validation. Preview as escaped text, not rendered Markdown, and refresh active metadata after replacement.

- [ ] **Step 6: Run configuration tests**

Run: `npm --workspace apps/web test -- settings standards providers`

Expected: PASS.

- [ ] **Step 7: Commit configuration UI**

```bash
git add apps/web/src/app/settings apps/web/src/app/standards apps/web/src/app/providers
git commit -m "feat: configure providers and standards"
```

### Task 3: New Review workflow

**Files:**
- Create: `apps/web/src/app/reviews/new-review/new-review-page.component.ts`
- Create: `apps/web/src/app/reviews/new-review/pr-url-field.component.ts`
- Create: `apps/web/src/app/reviews/new-review/pr-summary.component.ts`
- Create: `apps/web/src/app/reviews/new-review/main-model-selector.component.ts`
- Create: `apps/web/src/app/reviews/new-review/reviewer-selector.component.ts`
- Create: `apps/web/src/app/reviews/new-review/standards-status.component.ts`
- Create: `apps/web/src/app/reviews/new-review/additional-instructions.component.ts`
- Create: `apps/web/src/app/reviews/new-review/new-review.store.ts`
- Test: `apps/web/src/app/reviews/new-review/new-review-page.spec.ts`
- Test: `apps/web/src/app/reviews/new-review/new-review.store.spec.ts`

**Interfaces:**
- Consumes: `ProvidersStore`, standards metadata, `PullRequestSummarySchema`, `CreateReviewRequestSchema`, and `/api/reviews/active`.
- Produces: A validated `CreateReviewRequest` and navigation to the active job route after creation.

- [ ] **Step 1: Write failing New Review tests**

Cover invalid URL, PR validation loading/error/success, exact-one-main enforcement, at-least-one-reviewer enforcement, duplicate provider/model prevention, unavailable model disabling, missing-standards warning, optional instructions, preserved form state, and start disabled during another active job.

- [ ] **Step 2: Write failing long-content layout tests**

Assert full accessible labels for long repository/model names, visual truncation where needed, and usable layout at 1024 and 1440 pixels.

- [ ] **Step 3: Run tests to verify failure**

Run: `npm --workspace apps/web test -- new-review`

Expected: FAIL because the workflow is missing.

- [ ] **Step 4: Implement the validated PR workflow**

Keep URL validation separate from job creation. Invalidate a prior PR summary when the URL changes, and preserve provider selections after a recoverable validation error.

- [ ] **Step 5: Implement model selectors and standards state**

Use explicit provider tabs/cards and model selects backed only by selectable catalog entries. Show the main verifier's role, reviewer parallelism, standards hash, or the exact fallback warning.

- [ ] **Step 6: Implement job creation**

Validate through `CreateReviewRequestSchema` before POST, prevent double submission, and navigate only after the returned job validates.

- [ ] **Step 7: Run New Review tests**

Run: `npm --workspace apps/web test -- new-review`

Expected: PASS.

- [ ] **Step 8: Commit New Review**

```bash
git add apps/web/src/app/reviews/new-review
git commit -m "feat: add multi-model review setup"
```

### Task 4: Active Review pipeline and SSE state

**Files:**
- Create: `apps/web/src/app/reviews/active-review/active-review-page.component.ts`
- Create: `apps/web/src/app/reviews/active-review/pipeline-stage-list.component.ts`
- Create: `apps/web/src/app/reviews/active-review/reviewer-run-card.component.ts`
- Create: `apps/web/src/app/reviews/active-review/review-warning-list.component.ts`
- Create: `apps/web/src/app/reviews/active-review/sanitized-log.component.ts`
- Create: `apps/web/src/app/reviews/active-review/active-review.store.ts`
- Create: `apps/web/src/app/core/api/review-events.service.ts`
- Test: `apps/web/src/app/reviews/active-review/active-review-page.spec.ts`
- Test: `apps/web/src/app/reviews/active-review/active-review.store.spec.ts`
- Test: `apps/web/src/app/core/api/review-events.service.spec.ts`

**Interfaces:**
- Consumes: `ReviewJobSchema`, `ReviewEventSchema`, active-review routes, cancellation endpoint, and SSE stream.
- Produces: Monotonic active-job UI state and navigation to the report when completed.

- [ ] **Step 1: Write failing SSE tests**

Cover initial snapshot, monotonic event sequence, reconnect with duplicate events, temporary disconnect, terminal event closure, malformed event rejection, and 401 session expiry.

- [ ] **Step 2: Write failing pipeline tests**

Cover all eight stages, parallel reviewer states, partial failure, timeout, verifier start, cancellation confirmation, cancelling/cancelled states, all-reviewer failure, verifier failure, cleanup warning, and collapsed sanitized logs.

- [ ] **Step 3: Run active-review tests to verify failure**

Run: `npm --workspace apps/web test -- active-review review-events`

Expected: FAIL because event and page services are missing.

- [ ] **Step 4: Implement typed SSE state**

Validate each event, ignore duplicate sequence numbers, reject state regressions, reconnect with bounded backoff while non-terminal, and refetch the job snapshot before resuming live events.

- [ ] **Step 5: Implement the active pipeline UI**

Adapt the Stitch pipeline layout without fake token cost, telemetry, AST, air-gap, or consensus claims. Show concise activity, elapsed time, warnings, and one Cancel Review action.

- [ ] **Step 6: Run active-review tests**

Run: `npm --workspace apps/web test -- active-review review-events`

Expected: PASS.

- [ ] **Step 7: Commit active pipeline**

```bash
git add apps/web/src/app/reviews/active-review apps/web/src/app/core/api/review-events.service.ts
git commit -m "feat: show live review pipeline"
```

### Task 5: Final report, history, safety, and frontend handoff

**Files:**
- Create: `apps/web/src/app/reviews/report/report-page.component.ts`
- Create: `apps/web/src/app/reviews/report/report-metadata.component.ts`
- Create: `apps/web/src/app/reviews/report/report-toc.component.ts`
- Create: `apps/web/src/app/reviews/report/safe-markdown.component.ts`
- Create: `apps/web/src/app/reviews/report/rejected-claims-audit.component.ts`
- Create: `apps/web/src/app/reviews/history/review-history-page.component.ts`
- Create: `apps/web/src/app/reviews/history/review-history-filters.component.ts`
- Create: `apps/web/src/app/reviews/history/review-history-table.component.ts`
- Create: `apps/web/src/app/shared/confirm-dialog.component.ts`
- Test: `apps/web/src/app/reviews/report/safe-markdown.spec.ts`
- Test: `apps/web/src/app/reviews/report/report-page.spec.ts`
- Test: `apps/web/src/app/reviews/history/review-history-page.spec.ts`
- Test: `apps/web/src/app/accessibility.spec.ts`

**Interfaces:**
- Consumes: Saved `ReviewJobSchema`/`VerifiedReportSchema`, Markdown download endpoint, and history query responses.
- Produces: Safe report reading/copy/download and immutable searchable history.

- [ ] **Step 1: Write failing Markdown safety tests**

Cover raw HTML, script/style tags, event attributes, `javascript:` and data links, malformed Markdown, huge code blocks, long lines, tables, headings, and escaped repository-controlled text.

- [ ] **Step 2: Write failing report/history tests**

Cover metadata, severity ordering, location/evidence/impact/fix fields, reviewer origins, standards/fallback warnings, partial failure, exclusions, no findings, all claims rejected, collapsed audit, copy/download, search, filters, pagination, failed/cancelled rows, and copied-selection navigation.

- [ ] **Step 3: Write failing accessibility tests**

Cover landmark structure, heading order, labels, keyboard focus, dialog focus restoration, status announcements, color-independent states, long text at 1024 pixels, and no serious/critical axe violations.

- [ ] **Step 4: Run report/history tests to verify failure**

Run: `npm --workspace apps/web test -- report history accessibility`

Expected: FAIL because pages and safe renderer are missing.

- [ ] **Step 5: Implement safe Markdown rendering**

Disable raw HTML at parse time, sanitize the rendered result with DOMPurify, allow only expected protocols/tags/attributes, preserve code blocks, and keep links in the same local application unless explicitly external and safe.

- [ ] **Step 6: Implement report and history pages**

Use the Stitch hierarchy with lower information density. Present rendered Markdown as primary content, make warnings persistent, preserve immutable history, and exclude PDF/replay/re-evaluation/write actions.

- [ ] **Step 7: Run the frontend gate**

Run: `npm --workspace apps/web test && npm --workspace apps/web run build`

Expected: PASS with no remote Stitch asset or CDN reference.

- [ ] **Step 8: Commit frontend completion**

```bash
git add apps/web
git commit -m "feat: complete review reports and history"
```

- [ ] **Step 9: Hand off to Codex**

Send the branch and commit hash, tests run, screenshot comparison notes, accessibility results, shared contract assumptions, and deferred light/mobile behavior. Do not paste generated HTML or remote Stitch URLs into the handoff.

