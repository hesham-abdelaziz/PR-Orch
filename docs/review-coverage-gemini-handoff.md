# Gemini handoff — review coverage matrix in the report view

**Blocked until** Codex lands `ReviewAreaCoverage` / `ReviewerCoverage` and
`VerifiedReport.coverage` in `packages/contracts` (see `docs/review-coverage-codex-handoff.md`),
and Claude fills that field in the engine. Until then, code against the contract types. Treat
`coverage` as optional: older reports don't have it.

Ownership: **Gemini** owns `apps/web/**`. Do not edit `packages/contracts`, `apps/api`, or `tests/fixtures`.

## What the data means

Every reviewer must work through a fixed list of review areas, plus one area per section of the
project's standards file. For each area it attests one of:

- `checked` — it examined the change for that area
- `not_applicable` — the change has nothing that area applies to (with a note saying why)
- `missing` — it reported nothing for that area. Treat the area as **not reviewed** by that reviewer.

`VerifiedReport.coverage` holds one `{ reviewer, areas[] }` entry per completed reviewer. Each
area has `{ area, title, source: 'protocol' | 'standards', status, note? }`. All reviewers share
the same area ids and order.

## What to build (report page, below the findings)

1. **"Review coverage" section**, collapsed by default. Its summary line reads, for example,
   "All 22 areas covered by every reviewer", or "3 areas not reviewed by at least one reviewer".
2. **Matrix:** one row per area, one column per reviewer (`provider/model`).
   - Group the rows: the fixed protocol areas first, then "Project standards" sections.
   - Each cell shows the status as an icon **and** a text label (not colour alone), with the
     note as a tooltip or an expandable detail.
3. **Highlight rows** where any reviewer is `missing`. If **no** reviewer checked a row, mark it
   prominently as "Not reviewed by any reviewer".
4. **Accessibility:** use a real `<table>` with `<th scope>` headers, keyboard-reachable
   notes, and a status legend.
5. **Responsive:** on narrow screens, show one card per reviewer, each listing that
   reviewer's areas.
6. **Empty or old reports:** when `coverage` is absent, hide the section. Don't show an empty table.

The job warnings already on the page ("Reviewer X did not report coverage for …") stay as they
are. The matrix is the detailed view behind them.

## Tests

Component specs for each of these:

- all areas covered
- a missing area for one reviewer
- an area missing for every reviewer
- `not_applicable` with its note
- `coverage` absent

Plus an accessibility check that the table headers are associated with their cells.
