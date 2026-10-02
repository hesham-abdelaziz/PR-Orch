import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { NewReviewStore } from './new-review.store';
import { PrUrlFieldComponent } from './pr-url-field.component';
import { PrSummaryComponent } from './pr-summary.component';
import { MainModelSelectorComponent } from './main-model-selector.component';
import { ReviewerSelectorComponent } from './reviewer-selector.component';
import { StandardsStatusComponent } from './standards-status.component';
import { AdditionalInstructionsComponent } from './additional-instructions.component';
import { RepositoryGuidanceFieldComponent } from './repository-guidance-field.component';
import { ProviderQuotasStore } from '../../providers/provider-quotas.store';

@Component({
  selector: 'app-new-review-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    PrUrlFieldComponent,
    PrSummaryComponent,
    MainModelSelectorComponent,
    ReviewerSelectorComponent,
    StandardsStatusComponent,
    AdditionalInstructionsComponent,
    RepositoryGuidanceFieldComponent,
  ],
  template: `
    <div class="new-review-page">
      <!-- Page Header -->
      <div class="page-header">
        <div class="header-content">
          <div class="breadcrumbs font-mono">
            <span>orchestrator</span> / <span class="active">new-review</span>
          </div>
          <h1>New PR Review</h1>
          <p class="header-desc">
            Single-tenant local orchestrator. Read-only static inspection using local AI CLI binaries without external repository mutations.
          </p>
        </div>

        <div class="header-badges">
          <span class="badge badge-readonly font-mono">
            <span>🔒</span>
            <span>READ-ONLY MODE</span>
          </span>
        </div>
      </div>

      <!-- Active Job Warning Banner if one is already running -->
      @if (store.activeJob()) {
        <div class="active-job-alert" role="alert">
          <div class="alert-content">
            <span class="alert-glyph">⚠</span>
            <div>
              <strong>Another review job is currently active</strong>
              <p>
                PR #{{ store.activeJob()?.pullRequest?.pullRequestId }} ({{ store.activeJob()?.pullRequest?.title }}) is currently {{ store.activeJob()?.state }}. The local orchestrator operates on a single active job at a time.
              </p>
            </div>
          </div>
          <a [routerLink]="['/reviews', store.activeJob()?.id || 'active']" class="btn-primary view-active-btn">
            Open ongoing review →
          </a>
        </div>
      }

      <!-- Main Layout Grid -->
      <div class="review-grid">
        <!-- Left / Main Column -->
        <div class="main-column">
          <!-- Step 1: Target PR -->
          <app-pr-url-field
            [url]="store.prUrl()"
            [validating]="store.validatingPr()"
            [error]="store.prError()"
            [validated]="!!store.prSummary()"
            (urlChange)="store.setPrUrl($event)"
            (validate)="store.validatePr()"
            (clear)="store.clearPr()"
          />

          @if (store.prSummary()) {
            <app-pr-summary [summary]="store.prSummary()" />
          }

          <!-- Step 2: Main Verifier Model -->
          <app-main-model-selector
            [selection]="store.mainSelection()"
            [availableModels]="store.providersStore.allInstalledModels()"
            (selectionChange)="store.setMainSelection($event)"
          />

          <!-- Step 3: Reviewer Models -->
          <app-reviewer-selector
            [reviewers]="store.reviewerSelections()"
            [availableModels]="store.providersStore.allInstalledModels()"
            (add)="store.addReviewer($event)"
            (remove)="store.removeReviewer($event)"
              (update)="store.updateReviewerSelection($event.index, $event.selection)"
          />

          <!-- Step 4: Optional Instructions -->
          <app-additional-instructions
            [instructions]="store.additionalInstructions()"
            (instructionsChange)="store.setAdditionalInstructions($event)"
          />

          <!-- Step 5: Optional Repository Guidance -->
          <app-repository-guidance-field
            [guidance]="store.repositoryGuidance()"
            [fileSize]="store.guidanceSize()"
            [reading]="store.readingGuidance()"
            [error]="store.guidanceError()"
            (fileSelected)="store.setGuidanceFile($event)"
            (remove)="store.clearGuidance()"
          />
        </div>

        <!-- Right Rail / Summary Column -->
        <div class="side-column">
          <!-- Standards status -->
          <app-standards-status
            [standards]="store.standards()"
            [loading]="store.loadingStandards()"
          />

          <!-- Review Run Spec Card -->
          <div class="spec-card">
            <h3>Execution Architecture</h3>
            <div class="spec-items font-mono">
              <div class="spec-item">
                <span class="spec-label">Reviewers</span>
                <span class="spec-val">{{ store.reviewerSelections().length }} Parallel</span>
              </div>
              <div class="spec-item">
                <span class="spec-label">Verifier</span>
                <span class="spec-val">{{ store.mainSelection()?.model || 'None selected' }}</span>
              </div>
              <div class="spec-item">
                <span class="spec-label">Isolation</span>
                <span class="spec-val">Local Temp Workspace</span>
              </div>
              <div class="spec-item">
                <span class="spec-label">Azure DevOps</span>
                <span class="spec-val">Zero Mutations</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Execution Sticky Bottom Dock -->
      <aside aria-label="Execution controls" class="execution-dock">
        <div class="dock-inner">
          <div class="dock-telemetry">
            <div class="target-title">
              @if (store.prSummary()) {
                <span class="text-primary font-mono font-semibold">
                  PR #{{ store.prSummary()!.pullRequestId }}
                </span>
                <span class="text-muted">|</span>
                <span class="text-secondary truncate max-w-xs font-mono">
                  {{ store.prSummary()!.changedFiles }} files
                </span>
              } @else {
                <span class="text-muted font-mono">No Pull Request Validated</span>
              }
            </div>
            <div class="models-summary font-mono text-muted">
              1 Verifier · {{ store.reviewerSelections().length }} Reviewers
            </div>
          </div>

          @if (store.submitError()) {
            <div class="dock-error" role="alert">
              <span>⚠</span>
              <span>{{ store.submitError() }}</span>
              @if (store.activeReviewConflictId()) {
                <a [routerLink]="['/reviews', store.activeReviewConflictId()]" class="dock-error-link">
                  Open ongoing review →
                </a>
              }
            </div>
          }

          <div class="dock-actions">
            <button
              id="start-review-btn"
              type="button"
              class="btn-primary start-btn"
              [disabled]="!store.canSubmit()"
              (click)="onStartReview()"
            >
              <span class="play-icon">▶</span>
              <span>{{ store.submitting() ? 'Starting Review...' : 'Start Orchestrated Review' }}</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .new-review-page {
      padding: 24px 32px 100px 32px;
      max-width: 1400px;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 24px;
      gap: 16px;

      .breadcrumbs {
        font-size: 11px;
        color: $text-muted;
        margin-bottom: 8px;

        .active {
          color: $accent-primary;
        }
      }

      h1 {
        font-size: 20px;
        font-weight: 700;
        color: $text-primary;
        margin-bottom: 6px;
      }

      .header-desc {
        font-size: 13px;
        color: $text-secondary;
        max-width: 720px;
      }
    }

    .badge {
      @include mono-badge;
    }

    .badge-readonly {
      background-color: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: $accent-primary;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
    }

    .active-job-alert {
      background-color: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.4);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;

      .alert-content {
        display: flex;
        align-items: flex-start;
        gap: 12px;

        .alert-glyph {
          font-size: 20px;
          color: $severity-medium;
        }

        strong {
          color: $severity-medium;
          font-size: 13px;
        }

        p {
          font-size: 12px;
          color: $text-secondary;
          margin-top: 2px;
        }
      }

      .view-active-btn {
        white-space: nowrap;
        text-decoration: none;
      }
    }

    .review-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;

      @media (min-width: 1024px) {
        grid-template-columns: 2fr 1fr;
      }
    }

    .main-column {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .side-column {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .spec-card {
      @include card-surface;
      padding: 18px 20px;

      h3 {
        font-size: 13px;
        font-weight: 600;
        color: $text-primary;
        margin-bottom: 12px;
      }

      .spec-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 11px;
      }

      .spec-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 6px;
        border-bottom: 1px solid $border-subtle;

        &:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
      }

      .spec-label {
        color: $text-muted;
      }

      .spec-val {
        color: $text-secondary;
      }
    }

    .execution-dock {
      position: fixed;
      bottom: 0;
      left: 260px;
      right: 0;
      background-color: rgba(22, 27, 34, 0.95);
      backdrop-filter: blur(12px);
      border-top: 1px solid $border-subtle;
      padding: 12px 32px;
      z-index: 30;
      box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.4);
    }

    .dock-inner {
      max-width: 1336px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .dock-telemetry {
      display: flex;
      flex-direction: column;
      gap: 2px;

      .target-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }

      .models-summary {
        font-size: 11px;
      }
    }

    .dock-error {
      padding: 6px 12px;
      background-color: rgba(248, 81, 73, 0.15);
      border: 1px solid rgba(248, 81, 73, 0.3);
      border-radius: 4px;
      color: #ffb4ab;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;

      .dock-error-link {
        color: $accent-primary;
        text-decoration: underline;
        margin-left: 6px;
        font-weight: 600;

        &:hover {
          color: $accent-primary-hover;
        }
      }
    }

    .dock-actions {
      display: flex;
      align-items: center;
    }

    .start-btn {
      padding: 10px 20px;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;

      .play-icon {
        font-size: 11px;
      }
    }

    .truncate {
      @include truncate;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class NewReviewPageComponent implements OnInit {
  readonly store = inject(NewReviewStore);
  readonly providerQuotasStore = inject(ProviderQuotasStore, { optional: true });
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    this.providerQuotasStore?.loadQuotas().catch(() => {});
    await this.store.loadInitialData();
  }

  async onStartReview(): Promise<void> {
    try {
      const job = await this.store.createReview();
      await this.router.navigate(['/reviews', job.id]);
    } catch {
      // Error message is set inside store.submitError
    }
  }
}
