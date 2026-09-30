import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReviewJob } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-review-history-table',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="table-container">
      <table class="history-table" aria-label="Review history table">
        <thead>
          <tr class="font-mono">
            <th class="col-pr">PULL REQUEST</th>
            <th class="col-repo">REPOSITORY</th>
            <th class="col-branches">BRANCHES</th>
            <th class="col-verifier">VERIFIER</th>
            <th class="col-reviewers">REVIEWERS</th>
            <th class="col-date">DATE</th>
            <th class="col-status">STATUS</th>
          </tr>
        </thead>
        <tbody>
          @if (jobs.length === 0) {
            <tr>
              <td colspan="7" class="empty-state font-mono">
                No review history records found matching criteria.
              </td>
            </tr>
          } @else {
            @for (job of jobs; track job.id) {
              <tr
                class="history-row"
                tabindex="0"
                role="button"
                (click)="rowClick.emit(job)"
                (keydown.enter)="rowClick.emit(job)"
                [attr.aria-label]="'View report for PR #' + job.pullRequest.pullRequestId"
              >
                <!-- PR Title & ID -->
                <td class="col-pr">
                  <div class="pr-cell">
                    <span class="badge-pr font-mono">PR #{{ job.pullRequest.pullRequestId }}</span>
                    <span class="pr-title truncate" [title]="job.pullRequest.title">
                      {{ job.pullRequest.title }}
                    </span>
                  </div>
                </td>

                <!-- Repo -->
                <td class="col-repo font-mono truncate" [title]="job.pullRequest.organization + ' / ' + job.pullRequest.repository">
                  {{ job.pullRequest.repository }}
                </td>

                <!-- Branches -->
                <td class="col-branches font-mono truncate" [title]="job.pullRequest.sourceBranch + ' → ' + job.pullRequest.targetBranch">
                  {{ job.pullRequest.sourceBranch }} → {{ job.pullRequest.targetBranch }}
                </td>

                <!-- Verifier -->
                <td class="col-verifier font-mono">
                  <span class="provider-glyph" [class]="job.main.provider">●</span>
                  {{ job.main.model }}
                </td>

                <!-- Reviewers -->
                <td class="col-reviewers">
                  <div class="reviewers-count font-mono">
                    {{ job.reviewers.length }} reviewer{{ job.reviewers.length === 1 ? '' : 's' }}
                  </div>
                </td>

                <!-- Date -->
                <td class="col-date font-mono">
                  {{ job.createdAt | date:'short' }}
                </td>

                <!-- Status Badge -->
                <td class="col-status">
                  <span class="badge-status font-mono" [class]="'status-' + job.state">
                    {{ job.state | uppercase }}
                  </span>
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .table-container {
      @include card-surface;
      overflow-x: auto;
    }

    .history-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      text-align: left;

      thead {
        background-color: $bg-surface-2;
        border-bottom: 1px solid $border-subtle;

        th {
          padding: 12px 16px;
          font-size: 10px;
          color: $text-muted;
          letter-spacing: 0.04em;
          font-weight: 600;
          white-space: nowrap;
        }
      }

      tbody tr {
        border-bottom: 1px solid $border-subtle;
        transition: background-color 0.15s ease;

        &:last-child {
          border-bottom: none;
        }

        &.history-row {
          cursor: pointer;

          &:hover {
            background-color: $bg-surface-2;
          }

          &:focus-visible {
            outline: 1px solid $accent-primary;
            background-color: $bg-surface-2;
          }
        }

        td {
          padding: 12px 16px;
          vertical-align: middle;
        }
      }
    }

    .pr-cell {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 200px;
      max-width: 320px;
    }

    .badge-pr {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $accent-primary;
      font-size: 10px;
      flex-shrink: 0;
    }

    .pr-title {
      font-weight: 600;
      color: $text-primary;
      font-size: 12px;
    }

    .provider-glyph {
      font-size: 8px;
      margin-right: 2px;

      &.claude { color: $provider-claude; }
      &.codex { color: $provider-codex; }
      &.gemini { color: $provider-gemini; }
    }

    .reviewers-count {
      font-size: 11px;
      color: $text-secondary;
    }

    .badge-status {
      @include mono-badge;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;

      &.status-completed {
        background-color: rgba(63, 185, 80, 0.15);
        color: $status-clean;
        border: 1px solid rgba(63, 185, 80, 0.4);
      }

      &.status-running {
        background-color: rgba(56, 189, 248, 0.15);
        color: $accent-primary;
        border: 1px solid rgba(56, 189, 248, 0.4);
      }

      &.status-cancelled {
        background-color: rgba(245, 158, 11, 0.15);
        color: $severity-medium;
        border: 1px solid rgba(245, 158, 11, 0.4);
      }

      &.status-failed {
        background-color: rgba(248, 81, 73, 0.15);
        color: $severity-critical;
        border: 1px solid rgba(248, 81, 73, 0.4);
      }
    }

    .empty-state {
      text-align: center;
      padding: 48px 16px;
      color: $text-muted;
      font-size: 12px;
    }

    .truncate {
      @include truncate;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReviewHistoryTableComponent {
  @Input() jobs: ReviewJob[] = [];
  @Output() rowClick = new EventEmitter<ReviewJob>();
}
