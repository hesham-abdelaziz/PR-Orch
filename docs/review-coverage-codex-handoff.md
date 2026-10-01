# Codex handoff — review protocol coverage: shared contracts

Repository: `C:\Users\EGDev06\PR-Orch`, on top of `main` @ `2198128` plus Claude's uncommitted
review-protocol change (see below). Contracts only; no migration is needed.

## Ownership

| Owner | Files |
| --- | --- |
| **Codex (you)** | `packages/contracts/**` |
| Claude | `apps/api/src/reviews/**`, `apps/api/src/reports/**`, `apps/api/src/providers/**`, `tests/fixtures/fake-clis/**` |
| Gemini | `apps/web/**` |

## What Claude already changed (engine only)

- Every reviewer prompt now has a `# REVIEW PROTOCOL` section: 10 fixed areas
  (`apps/api/src/reviews/prompts/review-protocol.ts` → `PROTOCOL_AREAS`), plus one area per
  `##` section in the job's standards file (`standards-1`, `standards-2`, …).
- The reviewer **wire** schema (`apps/api/src/reviews/output/review-output.schemas.ts`) now
  requires `coverage: [{ area, status: 'checked' | 'not_applicable', note }]`.
- The engine compares that list with the required areas (`output/coverage-check.ts`). Gaps are
  recorded as job warnings ("Reviewer X did not report coverage for N of M review areas (…)") and
  in the run's `sanitizedLog`.
- At the moment coverage is **not stored**. `ReviewerResult` and `VerifiedReport` have no field
  for it, so the per-area matrix is lost after the run. Your change adds those fields.

## Part 1: `packages/contracts/src/findings.ts`

```ts
export const ReviewAreaSourceSchema = z.enum(['protocol', 'standards']);
export const ReviewAreaStatusSchema = z.enum(['checked', 'not_applicable', 'missing']);

/** One required review area and what a reviewer attested for it ('missing' = no entry). */
export const ReviewAreaCoverageSchema = z.strictObject({
  area: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  source: ReviewAreaSourceSchema,
  status: ReviewAreaStatusSchema,
  /** The reviewer's note; absent when status is 'missing'. */
  note: z.string().trim().min(1).max(500).optional(),
});

export const ReviewerCoverageSchema = z.strictObject({
  reviewer: ModelSelectionSchema,
  areas: z.array(ReviewAreaCoverageSchema).max(200),
});
```

- `ReviewerResultSchema`: add `coverage: z.array(ReviewAreaCoverageSchema).max(200).optional()`.
- `VerifiedReportSchema`: add `coverage: z.array(ReviewerCoverageSchema).max(10).optional()`.
  It holds one entry per **completed** reviewer, in reviewer order.
- Export the schemas and their `z.infer` types (`ReviewAreaCoverage`, `ReviewerCoverage`) from `src/index.ts`.

Both fields must be **optional**. Stored `reviewer_runs.result` and `reports.report` JSON
written before this change has no coverage, and it must still validate. For that reason there is
no migration: both columns are already JSON.

## Part 2: tests

Add contract specs for each of these:

- A valid coverage entry is accepted, with and without `note`.
- Unknown `status` or `source` values are rejected.
- An empty `area` or `title` is rejected.
- Extra keys are rejected (strict object).
- A `ReviewerResult` and a `VerifiedReport` **without** `coverage` still parse.

Run `npm run test:contracts`.

## Not in scope (Claude follows up once this lands)

Claude will then make these changes in the engine:

- fill `ReviewerResult.coverage` in the normalizer
- fill `VerifiedReport.coverage` in `verifier-report.assembler.ts`
- add a "Review coverage" section to the Markdown report
- update the fixtures

Gemini will build the dashboard view from `VerifiedReport.coverage`.
