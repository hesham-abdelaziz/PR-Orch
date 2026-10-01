import { Component, OnInit, OnDestroy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { ActiveReviewStore } from './active-review.store';
import { PipelineStageListComponent } from './pipeline-stage-list.component';
import { ReviewWarningListComponent } from './review-warning-list.component';
import { ReviewerRunCardComponent } from './reviewer-run-card.component';

@Component({
  selector: 'app-active-review-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PipelineStageListComponent,
    ReviewWarningListComponent,
    ReviewerRunCardComponent,
  ],
  template: `
    <div class="active-review-page">
      @if (store.loading()) {
        <div class="loading-state">
          <div class="pulse-dot"></div>
          <span class="font-mono">Connecting to review stream...</span>
        </div>
      } @else if (!store.job()) {
        <div class="empty-state">
          <div class="empty-glyph font-mono">◈</div>
          <h2>No Active Review In Progress</h2>
          <p>There are no reviews currently executing in the local sandbox.</p>
          <a routerLink="/reviews/new" class="btn btn-primary font-mono">Start New PR Review</a>
        </div>
      } @else {
        <!-- Page Header -->
        <header class="page-header">
          <div class="header-left">
            <div class="breadcrumbs">
              <a routerLink="/reviews/history">Reviews</a>
              <span>/</span>
              <span class="active font-mono">#{{ store.job()!.pullRequest.pullRequestId }}</span>
              <span class="job-badge font-mono">{{ store.job()!.id.slice(0, 8) }}</span>
            </div>
            <div class="title-row">
              <h1>PR #{{ store.job()!.pullRequest.pullRequestId }}: {{ store.job()!.pullRequest.title }}</h1>
              <span class="status-pill font-mono" [class]="'state-' + store.job()!.state">
                @if (store.job()!.state === 'reviewing' || store.job()!.state === 'verifying' || store.job()!.state === 'rendering') {
                  <span class="pulse-dot"></span>
                }
                {{ store.job()!.state | uppercase }}
              </span>
            </div>
          </div>

          <div class="header-actions">
            @if (store.canCancel()) {
              <button
                id="cancel-review-btn"
                type="button"
                class="btn btn-danger cancel-btn font-mono"
                [disabled]="store.cancelling()"
                (click)="onCancel()"
              >
                @if (store.cancelling()) {
                  <span>Cancelling...</span>
                } @else {
                  <span>Cancel Review</span>
                }
              </button>
            }

            @if (store.job()!.state === 'completed') {
              <a
                [routerLink]="['/reviews', store.job()!.id]"
                class="btn btn-primary report-btn font-mono"
              >
                <span>View Final Report →</span>
              </a>
            }
          </div>
        </header>

        <!-- Completion Banners -->
        @if (store.job()!.state === 'completed') {
          <div class="completed-banner" role="status">
            <span class="banner-glyph">✓</span>
            <span>Review completed successfully. All stages finished and verified report has been assembled.</span>
            <a [routerLink]="['/reviews', store.job()!.id]" class="btn btn-outline btn-sm ml-auto font-mono">
              Open Report
            </a>
          </div>
        }

        @if (store.job()!.state === 'cancelled') {
          <div class="cancelled-banner" role="status">
            <span class="banner-glyph">⊘</span>
            <span>Review was cancelled by user. Partial results have been saved and workspaces cleaned.</span>
          </div>
        }

        @if (store.job()!.state === 'failed') {
          <div class="failed-banner" role="alert">
            <span class="banner-glyph">⚠</span>
            <div class="banner-body">
              <span class="banner-message">{{ displayedFailureBannerText() }}</span>
              @if (isFailureBannerTruncatable()) {
                <button
                  type="button"
                  class="banner-expand-btn font-mono"
                  (click)="toggleFailureBannerExpand()"
                >
                  {{ isFailureBannerExpanded() ? 'Show less' : 'Show more' }}
                </button>
              }
            </div>
          </div>
        }

        <!-- Telemetry Strip -->
        <div class="telemetry-strip font-mono">
          <div class="telemetry-cell">
            <span class="telemetry-label">REPOSITORY</span>
            <span class="telemetry-val truncate">
              {{ store.job()!.pullRequest.organization }}/{{ store.job()!.pullRequest.project }}/{{ store.job()!.pullRequest.repository }}
            </span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">DIFF IMPACT</span>
            <span class="telemetry-val">
              {{ store.job()!.pullRequest.changedFiles }} files (+{{ store.job()!.pullRequest.additions }}/-{{ store.job()!.pullRequest.deletions }})
            </span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">TARGET BRANCH</span>
            <span class="telemetry-val text-success">
              {{ store.job()!.pullRequest.targetBranch }}
            </span>
          </div>
          <div class="telemetry-cell">
            <span class="telemetry-label">SOURCE BRANCH</span>
            <span class="telemetry-val text-muted">
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

        <!-- Main Verifier Unit Section -->
        @if (store.job()!.verifier; as verifierRun) {
          <div class="verifier-section">
            <div class="section-title-row">
              <h2>Main Verifier Model</h2>
              <span class="font-mono text-muted text-xs">SYNTHESIS & AUDIT</span>
            </div>
            <app-reviewer-run-card [run]="verifierRun" [isVerifier]="true" />
          </div>
        }
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

    .reviewers-section, .verifier-section {
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
