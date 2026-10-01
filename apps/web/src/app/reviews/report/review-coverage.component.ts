import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  CoverageAreaSource,
  CoverageStatus,
  ReviewAreaCoverage,
  ReviewerCoverage,
} from './review-coverage.model';

export interface AreaRowCell {
  reviewerKey: string;
  reviewerLabel: string;
  status: CoverageStatus;
  note?: string;
}

export interface AreaRow {
  area: string;
  title: string;
  source: CoverageAreaSource;
  cells: AreaRowCell[];
  hasMissing: boolean;
  isNotReviewedByAny: boolean;
}

export interface ReviewerColumn {
  key: string;
  label: string;
}

@Component({
  selector: 'app-review-coverage',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (hasCoverage()) {
      <section id="review-coverage" class="report-section coverage-section">
        <details class="coverage-details" [open]="isOpen()" (toggle)="onToggle($event)">
          <summary class="coverage-summary font-mono">
            <div class="summary-left">
              <span class="disclosure-arrow" aria-hidden="true">▶</span>
              <span class="section-title">Review Coverage</span>
            </div>
            <div class="summary-right">
              <span
                class="coverage-summary-badge"
                [class.badge-clean]="unreviewedAreaCount() === 0"
                [class.badge-warning]="unreviewedAreaCount() > 0"
              >
                {{ summaryLine() }}
              </span>
            </div>
          </summary>

          <div class="coverage-content">
            <!-- Status Legend -->
            <div class="coverage-legend font-mono" role="region" aria-label="Coverage status legend">
              <span class="legend-heading">STATUS LEGEND:</span>
              <div class="legend-items">
                <div class="legend-item">
                  <span class="status-indicator status-checked">
                    <span class="status-icon" aria-hidden="true">✓</span>
                    <span class="status-label">Checked</span>
                  </span>
                  <span class="legend-desc">— Examined change for area</span>
                </div>
                <div class="legend-item">
                  <span class="status-indicator status-not-applicable">
                    <span class="status-icon" aria-hidden="true">⊘</span>
                    <span class="status-label">Not Applicable</span>
                  </span>
                  <span class="legend-desc">— Does not apply to this change</span>
                </div>
                <div class="legend-item">
                  <span class="status-indicator status-missing">
                    <span class="status-icon" aria-hidden="true">✕</span>
                    <span class="status-label">Missing</span>
                  </span>
                  <span class="legend-desc">— Not reviewed by reviewer</span>
                </div>
              </div>
            </div>

            <!-- Desktop Matrix Table -->
            <div class="coverage-matrix-view">
              <table class="coverage-table" aria-label="Review coverage matrix">
                <caption class="sr-only">Review Coverage by Reviewer and Area</caption>
                <thead>
                  <tr>
                    <th scope="col" class="th-area">Review Area</th>
                    @for (col of reviewerColumns(); track col.key) {
                      <th scope="col" class="th-reviewer font-mono">{{ col.label }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  <!-- Protocol Areas Group -->
                  <tr class="group-header-row">
                    <th
                      scope="colgroup"
                      [attr.colspan]="totalColumns()"
                      class="group-header font-mono"
                    >
                      Protocol Areas
                    </th>
                  </tr>
                  @for (row of protocolRows(); track row.area) {
                    <tr
                      [class.row-missing]="row.hasMissing"
                      [class.row-unreviewed]="row.isNotReviewedByAny"
                    >
                      <th scope="row" class="area-header">
                        <div class="area-info">
                          <span class="area-title">{{ row.title }}</span>
                          @if (row.isNotReviewedByAny) {
                            <span class="badge-not-reviewed font-mono" role="status">
                              Not reviewed by any reviewer
                            </span>
                          }
                        </div>
                      </th>
                      @for (cell of row.cells; track cell.reviewerKey) {
                        <td class="cell-status" [class]="'cell-' + cell.status">
                          <div class="cell-content">
                            <span class="status-indicator font-mono" [class]="'status-' + cell.status">
                              <span class="status-icon" aria-hidden="true">{{ getStatusIcon(cell.status) }}</span>
                              <span class="status-label">{{ getStatusLabel(cell.status) }}</span>
                            </span>
                            @if (cell.note) {
                              <details class="cell-note font-mono">
                                <summary
                                  class="note-summary"
                                  [title]="cell.note"
                                  [attr.aria-label]="'Note for ' + row.title + ' from ' + cell.reviewerLabel + ': ' + cell.note"
                                >
                                  <span class="note-icon" aria-hidden="true">ℹ</span>
                                  <span class="note-label">Note</span>
                                </summary>
                                <div class="note-popover" role="note">
                                  {{ cell.note }}
                                </div>
                              </details>
                            }
                          </div>
                        </td>
                      }
                    </tr>
                  }

                  <!-- Project Standards Group -->
                  @if (standardsRows().length > 0) {
                    <tr class="group-header-row">
                      <th
                        scope="colgroup"
                        [attr.colspan]="totalColumns()"
                        class="group-header font-mono"
                      >
                        Project Standards
                      </th>
                    </tr>
                    @for (row of standardsRows(); track row.area) {
                      <tr
                        [class.row-missing]="row.hasMissing"
                        [class.row-unreviewed]="row.isNotReviewedByAny"
                      >
                        <th scope="row" class="area-header">
                          <div class="area-info">
                            <span class="area-title">{{ row.title }}</span>
                            @if (row.isNotReviewedByAny) {
                              <span class="badge-not-reviewed font-mono" role="status">
                                Not reviewed by any reviewer
                              </span>
                            }
                          </div>
                        </th>
                        @for (cell of row.cells; track cell.reviewerKey) {
                          <td class="cell-status" [class]="'cell-' + cell.status">
                            <div class="cell-content">
                              <span class="status-indicator font-mono" [class]="'status-' + cell.status">
                                <span class="status-icon" aria-hidden="true">{{ getStatusIcon(cell.status) }}</span>
                                <span class="status-label">{{ getStatusLabel(cell.status) }}</span>
                              </span>
                              @if (cell.note) {
                                <details class="cell-note font-mono">
                                  <summary
                                    class="note-summary"
                                    [title]="cell.note"
                                    [attr.aria-label]="'Note for ' + row.title + ' from ' + cell.reviewerLabel + ': ' + cell.note"
                                  >
                                    <span class="note-icon" aria-hidden="true">ℹ</span>
                                    <span class="note-label">Note</span>
                                  </summary>
                                  <div class="note-popover" role="note">
                                    {{ cell.note }}
                                  </div>
                                </details>
                              }
                            </div>
                          </td>
                        }
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>

            <!-- Responsive Mobile Cards View -->
            <div class="coverage-cards-view">
              @for (rev of coverageList(); track getReviewerKey(rev)) {
                <div class="reviewer-card">
                  <div class="reviewer-card-header font-mono">
                    <span class="reviewer-name">{{ getReviewerKey(rev) }}</span>
                  </div>

                  <div class="reviewer-card-body">
                    <!-- Protocol Areas -->
                    <div class="card-area-section">
                      <h4 class="card-section-title font-mono">Protocol Areas</h4>
                      <ul class="card-area-list">
                        @for (area of getAreasBySource(rev, 'protocol'); track area.area) {
                          <li class="card-area-item" [class.item-missing]="area.status === 'missing'">
                            <div class="card-area-header">
                              <span class="card-area-title">{{ area.title }}</span>
                              <span class="status-indicator font-mono" [class]="'status-' + area.status">
                                <span class="status-icon" aria-hidden="true">{{ getStatusIcon(area.status) }}</span>
                                <span class="status-label">{{ getStatusLabel(area.status) }}</span>
                              </span>
                            </div>
                            @if (area.note) {
                              <p class="card-area-note font-mono">
                                <span class="note-prefix">Note:</span> {{ area.note }}
                              </p>
                            }
                          </li>
                        }
                      </ul>
                    </div>

                    <!-- Project Standards -->
                    @if (getAreasBySource(rev, 'standards').length > 0) {
                      <div class="card-area-section">
                        <h4 class="card-section-title font-mono">Project Standards</h4>
                        <ul class="card-area-list">
                          @for (area of getAreasBySource(rev, 'standards'); track area.area) {
                            <li class="card-area-item" [class.item-missing]="area.status === 'missing'">
                              <div class="card-area-header">
                                <span class="card-area-title">{{ area.title }}</span>
                                <span class="status-indicator font-mono" [class]="'status-' + area.status">
                                  <span class="status-icon" aria-hidden="true">{{ getStatusIcon(area.status) }}</span>
                                  <span class="status-label">{{ getStatusLabel(area.status) }}</span>
                                </span>
                              </div>
                              @if (area.note) {
                                <p class="card-area-note font-mono">
                                  <span class="note-prefix">Note:</span> {{ area.note }}
                                </p>
                              }
                            </li>
                          }
                        </ul>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        </details>
      </section>
    }
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .coverage-section {
      margin-top: 16px;
    }

    .coverage-details {
      @include card-surface;
      overflow: hidden;

      &[open] {
        .disclosure-arrow {
          transform: rotate(90deg);
        }
      }
    }

    .coverage-summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px;
      cursor: pointer;
      user-select: none;
      list-style: none;
      background-color: $bg-surface-2;
      border-bottom: 1px solid transparent;

      &::-webkit-details-marker {
        display: none;
      }

      &:hover {
        background-color: $bg-surface-3;
      }

      &:focus-visible {
        outline: 1px solid $accent-primary;
      }
    }

    details[open] .coverage-summary {
      border-bottom-color: $border-subtle;
    }

    .summary-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .disclosure-arrow {
      font-size: 10px;
      color: $text-muted;
      transition: transform 0.15s ease;
    }

    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: $text-secondary;
    }

    .coverage-summary-badge {
      @include mono-badge;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;

      &.badge-clean {
        background-color: rgba(63, 185, 80, 0.12);
        color: $status-clean;
        border: 1px solid rgba(63, 185, 80, 0.3);
      }

      &.badge-warning {
        background-color: rgba(245, 158, 11, 0.12);
        color: $severity-medium;
        border: 1px solid rgba(245, 158, 11, 0.3);
      }
    }

    .coverage-content {
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background-color: $bg-surface-1;
    }

    /* Legend */
    .coverage-legend {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding: 10px 14px;
      background-color: $bg-surface-2;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      font-size: 11px;
    }

    .legend-heading {
      color: $text-muted;
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 0.05em;
    }

    .legend-items {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .legend-desc {
      color: $text-muted;
      font-size: 10px;
    }

    /* Status indicators */
    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 500;
      padding: 2px 6px;
      border-radius: 4px;

      &.status-checked {
        color: $status-clean;
        background-color: rgba(63, 185, 80, 0.1);
        border: 1px solid rgba(63, 185, 80, 0.25);
      }

      &.status-not-applicable {
        color: $text-muted;
        background-color: rgba(110, 118, 129, 0.1);
        border: 1px solid rgba(110, 118, 129, 0.25);
      }

      &.status-missing {
        color: $severity-critical;
        background-color: rgba(248, 81, 73, 0.1);
        border: 1px solid rgba(248, 81, 73, 0.25);
      }
    }

    .status-icon {
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
    }

    /* Desktop Matrix Table */
    .coverage-matrix-view {
      overflow-x: auto;
      border: 1px solid $border-default;
      border-radius: 6px;
      background-color: $bg-surface-2;
    }

    .coverage-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 12px;

      thead th {
        background-color: $bg-surface-3;
        color: $text-secondary;
        font-weight: 600;
        padding: 10px 14px;
        border-bottom: 1px solid $border-default;
        border-right: 1px solid $border-subtle;

        &:last-child {
          border-right: none;
        }
      }

      .th-area {
        min-width: 220px;
        width: 35%;
      }

      .th-reviewer {
        min-width: 160px;
        font-size: 11px;
      }

      tbody tr {
        border-bottom: 1px solid $border-subtle;
        transition: background-color 0.15s ease;

        &:last-child {
          border-bottom: none;
        }

        &:hover {
          background-color: rgba(255, 255, 255, 0.02);
        }

        &.row-missing {
          background-color: rgba(245, 158, 11, 0.05);

          .area-header {
            border-left: 3px solid $severity-medium;
          }
        }

        &.row-unreviewed {
          background-color: rgba(248, 81, 73, 0.08);

          .area-header {
            border-left: 3px solid $severity-critical;
          }
        }
      }

      .group-header-row th {
        background-color: $bg-surface-1;
        color: $accent-primary;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 8px 14px;
        border-top: 1px solid $border-subtle;
        border-bottom: 1px solid $border-subtle;
      }

      .area-header {
        padding: 10px 14px;
        color: $text-primary;
        font-weight: 500;
        border-right: 1px solid $border-subtle;
        border-left: 3px solid transparent;
      }

      .area-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .area-title {
        font-size: 12px;
      }

      .badge-not-reviewed {
        @include mono-badge;
        align-self: flex-start;
        font-size: 9px;
        font-weight: 600;
        background-color: rgba(248, 81, 73, 0.15);
        color: $severity-critical;
        border: 1px solid rgba(248, 81, 73, 0.35);
        text-transform: uppercase;
      }

      .cell-status {
        padding: 8px 14px;
        border-right: 1px solid $border-subtle;
        vertical-align: middle;

        &:last-child {
          border-right: none;
        }
      }

      .cell-content {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
    }

    /* Cell note */
    .cell-note {
      position: relative;
      display: inline-block;

      .note-summary {
        list-style: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 6px;
        background-color: $bg-surface-3;
        border: 1px solid $border-subtle;
        border-radius: 4px;
        font-size: 10px;
        color: $text-secondary;
        transition: background-color 0.15s ease, color 0.15s ease;

        &::-webkit-details-marker {
          display: none;
        }

        &:hover {
          background-color: $bg-surface-elevated;
          color: $text-primary;
        }

        &:focus-visible {
          outline: 1px solid $accent-primary;
        }
      }

      .note-icon {
        font-size: 10px;
        color: $accent-primary;
      }

      .note-popover {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 0;
        z-index: 20;
        min-width: 220px;
        max-width: 320px;
        padding: 8px 10px;
        background-color: $bg-surface-elevated;
        border: 1px solid $border-default;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        color: $text-primary;
        font-size: 11px;
        line-height: 1.4;
        white-space: normal;
        word-break: break-word;
      }
    }

    /* Responsive Mobile Cards */
    .coverage-cards-view {
      display: none;
    }

    @media (max-width: 768px) {
      .coverage-matrix-view {
        display: none;
      }

      .coverage-cards-view {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .reviewer-card {
        background-color: $bg-surface-2;
        border: 1px solid $border-default;
        border-radius: 6px;
        overflow: hidden;
      }

      .reviewer-card-header {
        padding: 10px 14px;
        background-color: $bg-surface-3;
        border-bottom: 1px solid $border-subtle;
        font-size: 12px;
        font-weight: 600;
        color: $accent-primary;
      }

      .reviewer-card-body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .card-section-title {
        font-size: 10px;
        font-weight: 600;
        color: $text-muted;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 0 0 8px 0;
      }

      .card-area-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .card-area-item {
        background-color: $bg-surface-1;
        border: 1px solid $border-subtle;
        border-radius: 4px;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;

        &.item-missing {
          border-color: rgba(248, 81, 73, 0.3);
          background-color: rgba(248, 81, 73, 0.05);
        }
      }

      .card-area-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }

      .card-area-title {
        font-size: 12px;
        font-weight: 500;
        color: $text-primary;
      }

      .card-area-note {
        font-size: 11px;
        color: $text-secondary;
        margin: 0;
        padding-top: 4px;
        border-top: 1px dashed $border-subtle;
      }

      .note-prefix {
        color: $text-muted;
        font-weight: 600;
      }
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReviewCoverageComponent {
  private readonly _coverage = signal<ReviewerCoverage[]>([]);

  @Input()
  set coverage(value: ReviewerCoverage[] | undefined | null) {
    this._coverage.set(value ? [...value] : []);
  }

  readonly isOpen = signal(false);

  readonly coverageList = computed(() => this._coverage());

  readonly hasCoverage = computed(() => {
    const list = this._coverage();
    return list.length > 0 && list.some((r) => r.areas && r.areas.length > 0);
  });

  readonly reviewerColumns = computed<ReviewerColumn[]>(() => {
    return this._coverage().map((item) => {
      const key = `${item.reviewer.provider}/${item.reviewer.model}`;
      return {
        key,
        label: key,
      };
    });
  });

  readonly totalColumns = computed(() => this.reviewerColumns().length + 1);

  readonly areaRows = computed<AreaRow[]>(() => {
    const reviewers = this._coverage();
    if (reviewers.length === 0) return [];

    // All reviewers share the same area ids and order.
    // Collect unique area definitions in order from the first reviewer (or union across reviewers)
    const areaMap = new Map<string, { title: string; source: CoverageAreaSource }>();
    for (const rev of reviewers) {
      for (const area of rev.areas) {
        if (!areaMap.has(area.area)) {
          areaMap.set(area.area, { title: area.title, source: area.source });
        }
      }
    }

    const rows: AreaRow[] = [];
    for (const [areaId, info] of areaMap.entries()) {
      const cells: AreaRowCell[] = reviewers.map((rev) => {
        const found = rev.areas.find((a) => a.area === areaId);
        const reviewerKey = `${rev.reviewer.provider}/${rev.reviewer.model}`;
        if (!found) {
          return {
            reviewerKey,
            reviewerLabel: reviewerKey,
            status: 'missing' as CoverageStatus,
          };
        }
        return {
          reviewerKey,
          reviewerLabel: reviewerKey,
          status: found.status,
          note: found.note,
        };
      });

      const missingCount = cells.filter((c) => c.status === 'missing').length;
      const checkedCount = cells.filter((c) => c.status === 'checked').length;
      const allNotApplicable = cells.every((c) => c.status === 'not_applicable');

      const hasMissing = missingCount > 0;
      // Mark as not reviewed by any reviewer if missing for all reviewers, or if no reviewer checked and not all N/A
      const isNotReviewedByAny =
        missingCount === cells.length || (checkedCount === 0 && missingCount > 0 && !allNotApplicable);

      rows.push({
        area: areaId,
        title: info.title,
        source: info.source,
        cells,
        hasMissing,
        isNotReviewedByAny,
      });
    }

    return rows;
  });

  readonly protocolRows = computed(() =>
    this.areaRows().filter((r) => r.source === 'protocol'),
  );

  readonly standardsRows = computed(() =>
    this.areaRows().filter((r) => r.source === 'standards'),
  );

  readonly unreviewedAreaCount = computed(() => {
    return this.areaRows().filter((r) => r.hasMissing).length;
  });

  readonly summaryLine = computed(() => {
    const total = this.areaRows().length;
    const unreviewed = this.unreviewedAreaCount();

    if (unreviewed === 0) {
      return `All ${total} ${total === 1 ? 'area' : 'areas'} covered by every reviewer`;
    }

    if (unreviewed === 1) {
      return `1 area not reviewed by at least one reviewer`;
    }

    return `${unreviewed} areas not reviewed by at least one reviewer`;
  });

  getReviewerKey(rev: ReviewerCoverage): string {
    return `${rev.reviewer.provider}/${rev.reviewer.model}`;
  }

  getAreasBySource(rev: ReviewerCoverage, source: CoverageAreaSource): ReviewAreaCoverage[] {
    return rev.areas.filter((a) => a.source === source);
  }

  getStatusIcon(status: CoverageStatus): string {
    switch (status) {
      case 'checked':
        return '✓';
      case 'not_applicable':
        return '⊘';
      case 'missing':
        return '✕';
    }
  }

  getStatusLabel(status: CoverageStatus): string {
    switch (status) {
      case 'checked':
        return 'Checked';
      case 'not_applicable':
        return 'Not Applicable';
      case 'missing':
        return 'Missing';
    }
  }

  onToggle(event: Event): void {
    const details = event.target as HTMLDetailsElement;
    this.isOpen.set(details.open);
  }
}
