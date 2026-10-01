import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ActiveReviewStore } from './active-review.store';
import { PipelineStageListComponent } from './pipeline-stage-list.component';
import { ReviewerRunCardComponent } from './reviewer-run-card.component';
import { ReviewWarningListComponent } from './review-warning-list.component';

@Component({
  selector: 'app-active-review-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PipelineStageListComponent,
    ReviewerRunCardComponent,
    ReviewWarningListComponent,
  ],
  template: `
    <div class="active-review-page">
      @if (store.loading()) {
        <div class="loading-state font-mono">Loading active review pipeline...</div>
      } @else if (!store.job()) {
        <div class="empty-state">
          <div class="empty-glyph">⊘</div>
          <h2>No Active Review In Progress</h2>
          <p>There are no reviews currently executing in the local orchestrator.</p>
          <a routerLink="/reviews/new" class="btn-primary">Start New PR Review</a>
        </div>
      } @else {
        <!-- Operational Header -->
        <div class="page-header">
          <div class="header-left">
            <div class="breadcrumbs font-mono">
              <a routerLink="/reviews/history">reviews</a>
              <span>/</span>
              <span class="active">PR #{{ store.job()!.pullRequest.pullRequestId }}</span>
              <span class="job-badge font-mono">#job-{{ store.job()!.id.slice(0, 8) }}</span>
            </div>

            <div class="title-row">
              <h1>
                PR #{{ store.job()!.pullRequest.pullRequestId }}: {{ store.job()!.pullRequest.title }}
              </h1>
              <div class="status-pill font-mono" [class]="'state-' + store.job()!.state">
                <span class="pulse-dot" *ngIf="!store.isTerminal()"></span>
                <span>Stage: {{ store.job()!.state | uppercase }}</span>
              </div>
            </div>
          </div>

          <div class="header-actions">
            @if (store.canCancel()) {
              <button
                id="cancel-review-btn"
                type="button"
                class="btn-danger cancel-btn"
                [disabled]="store.cancelling()"
                (click)="onCancel()"
              >
                <span>✕</span>
                <span>{{ store.cancelling() ? 'Cancelling...' : 'Cancel Review' }}</span>
              </button>
            } @else if (store.job()!.state === 'completed') {
              <a [routerLink]="['/reviews', store.job()!.id]" class="btn-primary report-btn">
                <span>View Final Report</span>
                <span>→</span>
              </a>
            }
          </div>
        </div>

        <!-- Terminal Status Banner -->
        @if (store.job()!.state === 'completed') {
          <div class="completed-banner" role="status">
            <span>✓</span>
            <div>
              <strong>Review Complete!</strong>
              <span> All reviewer claims synthesized and verified report authored.</span>
            </div>
            <a [routerLink]="['/reviews', store.job()!.id]" class="btn-primary ml-auto">Open Report →</a>
          </div>
        } @else if (store.job()!.state === 'cancelled') {
          <div class="cancelled-banner" role="alert">
            <span>⊘</span>
            <span>Review was cancelled. Child CLI processes terminated.</span>
            <a routerLink="/reviews/new" class="btn-secondary ml-auto">Start Another Review</a>
          </div>
        } @else if (store.job()!.state === 'failed') {
          <div class="failed-banner" role="alert">
            <span class="banner-glyph">⚠</span>
            <div class="banner-body">
              <span class="banner-message">{{ displayedFailureBannerText() }}</span>
              @if (isFailureBannerTruncatable()) {
                <button
                  type="button"
                  class="banner-expand-btn font-mono"
                  (click)="toggleFailureBannerExpand()"
                  [attr.aria-expanded]="isFailureBannerExpanded()"
                >
                  {{ isFailureBannerExpanded() ? 'Show less' : 'Show more' }}
                </button>
              }
            </div>
            <a routerLink="/reviews/new" class="btn-secondary ml-auto">Start Another Review</a>
          </div>
        }

        <!-- Realtime Telemetry Strip -->
        <div class="telemetry-strip font-mono">
          <div class="telemetry-cell">
            <span class="telemetry-label">ISOLATION</span>
            <span class="telemetry-val">Read-only temp mount</span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">POLICY</span>
            <span class="telemetry-val text-success">Zero Git Remote Mutations</span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">VERIFIER</span>
            <span class="telemetry-val">{{ store.job()!.main.model }}</span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">BRANCH</span>
            <span class="telemetry-val truncate" [title]="store.job()!.pullRequest.sourceBranch">
              {{ store.job()!.pullRequest.sourceBranch }}
            </span>
          </div>
        </div>

        <!-- 8 Deterministic Pipeline Stages -->
        <app-pipeline-stage-list [stages]="store.stageStatuses()" />

        <!-- Warnings Region (excluding failure banner warning) -->
        <app-review-warning-list [warnings]="store.displayWarnings()" />

        <!-- Parallel Reviewers Section -->
        <div class="reviewers-section">
          <div class="section-title-row">
            <h2>Parallel Reviewer Models ({{ store.job()!.reviewers.length }})</h2>
            <span class="font-mono text-muted text-xs">ISOLATED PROCESS EXECUTION</span>
          </div>

          <div class="reviewers-grid">
            @for (run of store.job()!.reviewers; track run.id) {
              <app-reviewer-run-card [run]="run" />
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .active-review-page {
      padding: 24px 32px;
      max-width: 1400px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .loading-state, .empty-state {
      @include card-surface;
      padding: 40px;
      text-align: center;
      color: $text-muted;
    }

    .empty-state {
      padding: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;

      .empty-glyph { font-size: 32px; }
      h2 { font-size: 16px; font-weight: 600; color: $text-primary; }
      p { font-size: 13px; color: $text-secondary; margin-bottom: 8px; }
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }

    .header-left {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }

    .breadcrumbs {
      font-size: 11px;
      color: $text-muted;
      display: flex;
      align-items: center;
      gap: 6px;

      a {
        color: $text-secondary;
        text-decoration: none;
        &:hover { color: $accent-primary; }
      }

      .active { color: $text-primary; }
    }

    .job-badge {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $accent-verifier;
      font-size: 10px;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;

      h1 {
        font-size: 18px;
        font-weight: 700;
        color: $text-primary;
        margin: 0;
      }
    }

    .status-pill {
      @include mono-badge;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background-color: $bg-surface-2;
      border: 1px solid $border-subtle;
      color: $text-secondary;

      &.state-reviewing, &.state-verifying, &.state-rendering, &.state-preparing {
        background-color: rgba(56, 189, 248, 0.12);
        color: $accent-primary;
        border-color: rgba(56, 189, 248, 0.3);
      }

      &.state-completed {
        background-color: rgba(63, 185, 80, 0.12);
        color: $status-clean;
        border-color: rgba(63, 185, 80, 0.3);
      }

      &.state-cancelled, &.state-cancelling {
        background-color: rgba(245, 158, 11, 0.12);
        color: $severity-medium;
        border-color: rgba(245, 158, 11, 0.3);
      }

      &.state-failed {
        background-color: rgba(248, 81, 73, 0.12);
        color: $severity-critical;
        border-color: rgba(248, 81, 73, 0.3);
      }
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: $accent-primary;
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0% { opacity: 1; }
      50% { opacity: 0.3; }
      100% { opacity: 1; }
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .cancel-btn, .report-btn {
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .completed-banner, .cancelled-banner, .failed-banner {
      border-radius: 6px;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      border: 1px solid transparent;
    }

    .completed-banner {
      background-color: rgba(63, 185, 80, 0.12);
      border-color: rgba(63, 185, 80, 0.3);
      color: #9df2a6;
    }

    .cancelled-banner {
      background-color: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.3);
      color: $severity-medium;
    }

    .failed-banner {
      background-color: rgba(248, 81, 73, 0.12);
      border-color: rgba(248, 81, 73, 0.3);
      color: #ffdad6;
      align-items: flex-start;
    }

    .banner-glyph {
      font-size: 14px;
      line-height: 1.4;
      flex-shrink: 0;
    }

    .banner-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }

    .banner-message {
      line-height: 1.45;
      word-break: break-word;
    }

    .banner-expand-btn {
      background: none;
      border: none;
      padding: 0;
      color: $accent-primary;
      font-size: 11px;
      cursor: pointer;
      text-align: left;
      text-decoration: underline;
    }

    .telemetry-strip {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      background-color: $bg-surface-1;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid $border-subtle;

      @media (min-width: 768px) {
        grid-template-columns: repeat(4, 1fr);
      }
    }

    .telemetry-cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 11px;
    }

    .telemetry-label {
      color: $text-muted;
      font-size: 10px;
    }

    .telemetry-val {
      color: $text-primary;
    }

    .text-success {
      color: $status-clean;
    }

    .reviewers-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;

      h2 {
        font-size: 14px;
        font-weight: 600;
        color: $text-primary;
        margin: 0;
      }
    }

    .reviewers-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .truncate {
      @include truncate;
    }

    .font-mono {
      font-family: $font-mono;
    }

    .ml-auto {
      margin-left: auto;
    }
  `],
})
export class ActiveReviewPageComponent implements OnInit, OnDestroy {
  readonly store = inject(ActiveReviewStore);
  private readonly router = inject(Router);

  readonly isFailureBannerExpanded = signal<boolean>(false);

  readonly failureBannerText = computed(() => {
    return this.store.failureWarning() ?? 'Review failed during orchestration pipeline execution.';
  });

  readonly isFailureBannerTruncatable = computed(() => {
    return this.failureBannerText().length > 120;
  });

  readonly displayedFailureBannerText = computed(() => {
    const text = this.failureBannerText();
    if (!this.isFailureBannerTruncatable() || this.isFailureBannerExpanded()) {
      return text;
    }
    return text.slice(0, 120) + '…';
  });

  constructor() {
    effect(() => {
      const job = this.store.job();
      if (job && job.state === 'completed') {
        this.router.navigate([`/reviews/${job.id}`]);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    await this.store.loadJob();
  }

  ngOnDestroy(): void {
    this.store.disconnect();
  }

  async onCancel(): Promise<void> {
    await this.store.cancelReview();
  }

  toggleFailureBannerExpand(): void {
    this.isFailureBannerExpanded.update((v) => !v);
  }
}
