import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PullRequestSummary } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-pr-summary',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (summary) {
      <div class="pr-summary-card">
        <!-- Top header row -->
        <div class="summary-top">
          <div class="title-cluster">
            <span class="pr-badge font-mono">PR #{{ summary.pullRequestId }}</span>
            <h3 class="pr-title truncate" [title]="summary.title">{{ summary.title }}</h3>
          </div>
          <div class="commit-pill font-mono">
            <span class="commit-label">HEAD:</span>
            <span class="commit-hash" [title]="summary.sourceCommit">{{ summary.sourceCommit.slice(0, 7) }}</span>
          </div>
        </div>

        <!-- Branches & Repo metadata -->
        <div class="branch-meta-row">
          <div class="branches-wrapper">
            <span class="branch-pill font-mono truncate" [title]="summary.sourceBranch">{{ summary.sourceBranch }}</span>
            <span class="branch-arrow">→</span>
            <span class="branch-pill font-mono truncate" [title]="summary.targetBranch">{{ summary.targetBranch }}</span>
            <span class="meta-dot">·</span>
            <span
              class="repo-name font-mono truncate"
              [title]="summary.organization + ' / ' + summary.project + ' / ' + summary.repository"
            >
              {{ summary.organization }} / {{ summary.repository }}
            </span>
          </div>

          <div class="author-info">
            <span class="author-badge font-mono">{{ getAuthorInitials(summary.author.displayName) }}</span>
            <span class="author-name truncate" [title]="summary.author.displayName">
              {{ summary.author.displayName }}
            </span>
          </div>
        </div>

        <!-- Metrics bar -->
        <div class="metrics-grid">
          <div class="metric-card">
            <span class="metric-label">Scope</span>
            <span class="metric-value font-mono">{{ summary.changedFiles }} changed files</span>
          </div>
          @if (hasLineCounts()) {
            <div class="metric-card">
              <span class="metric-label">Additions</span>
              <span class="metric-value font-mono text-additions">+{{ summary.additions }}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Deletions</span>
              <span class="metric-value font-mono text-deletions">-{{ summary.deletions }}</span>
            </div>
            <div class="metric-card">
              <span class="metric-label">Net Delta</span>
              <span class="metric-value font-mono text-delta">
                {{ summary.additions - summary.deletions >= 0 ? '+' : '' }}{{ summary.additions - summary.deletions }}
              </span>
            </div>
          } @else {
            <div class="metric-card">
              <span class="metric-label">Line Changes</span>
              <span class="metric-value font-mono text-muted" title="Line counts are unavailable pre-review from Azure PR iteration metadata">Unavailable pre-review</span>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .pr-summary-card {
      @include card-surface;
      background-color: $bg-surface-2;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .summary-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }

    .title-cluster {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .pr-badge {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $accent-primary;
      font-weight: 600;
      white-space: nowrap;
    }

    .pr-title {
      font-size: 14px;
      font-weight: 600;
      color: $text-primary;
      @include truncate;
    }

    .commit-pill {
      font-size: 11px;
      color: $text-secondary;
      background-color: $bg-surface-1;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid $border-subtle;
      white-space: nowrap;

      .commit-label {
        color: $text-muted;
        margin-right: 4px;
      }

      .commit-hash {
        color: $text-primary;
      }
    }

    .branch-meta-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      font-size: 12px;
      color: $text-secondary;
    }

    .branches-wrapper {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }

    .branch-pill {
      background-color: $bg-surface-3;
      color: $text-primary;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      max-width: 220px;
      @include truncate;
    }

    .branch-arrow {
      color: $text-muted;
    }

    .meta-dot {
      color: $text-muted;
      padding: 0 2px;
    }

    .repo-name {
      color: $text-secondary;
      font-size: 11px;
      max-width: 320px;
      @include truncate;
    }

    .author-info {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .author-badge {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background-color: rgba(142, 213, 255, 0.15);
      color: $accent-primary;
      font-size: 10px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .author-name {
      font-size: 12px;
      color: $text-secondary;
      max-width: 200px;
      @include truncate;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;

      @media (min-width: 640px) {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    .metric-card {
      background-color: $bg-surface-1;
      padding: 8px 12px;
      border-radius: 4px;
      border: 1px solid $border-subtle;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .metric-label {
      font-size: 10px;
      font-weight: 500;
      color: $text-muted;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .metric-value {
      font-size: 12px;
      font-weight: 600;
      color: $text-primary;
    }

    .text-additions {
      color: $status-clean;
    }

    .text-deletions {
      color: $severity-critical;
    }

    .text-delta {
      color: $accent-primary;
    }

    .text-muted {
      color: $text-muted;
      font-size: 13px;
    }

    .truncate {
      @include truncate;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class PrSummaryComponent {
  @Input() summary: PullRequestSummary | null = null;

  hasLineCounts(): boolean {
    if (!this.summary) return false;
    return this.summary.additions > 0 || this.summary.deletions > 0;
  }

  getAuthorInitials(name: string): string {
    if (!name) return 'PR';
    const parts = name.trim().split(/[\s.]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }
}
