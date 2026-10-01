import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  JobState,
  ReviewEvent,
  ReviewFinding,
  ReviewJob,
  ReviewJobSchema,
  VerifiedReport,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../../core/api/api-client.service';
import { ApiError } from '../../core/api/api-error';
import { ReviewEventsService } from '../../core/api/review-events.service';
import { ReportIntegrationService } from './report-integration.service';
import { ReportMetadataComponent } from './report-metadata.component';
import { ReportTocComponent } from './report-toc.component';
import { RejectedClaimsAuditComponent } from './rejected-claims-audit.component';
import { FindingCardComponent } from './finding-card.component';
import { PipelineStageListComponent } from '../active-review/pipeline-stage-list.component';
import { ReviewerRunCardComponent } from '../active-review/reviewer-run-card.component';
import { ReviewWarningListComponent } from '../active-review/review-warning-list.component';
import { ActiveReviewStore, StageInfo, StageKey, StageStatus, calculateStageStatuses } from '../active-review/active-review.store';
import { ReviewCoverageComponent } from './review-coverage.component';
import { VerifiedReportWithCoverage } from './review-coverage.model';

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

@Component({
  selector: 'app-report-page',
  standalone: true,
  providers: [ActiveReviewStore],
  imports: [
    CommonModule,
    RouterLink,
    ReportMetadataComponent,
    ReportTocComponent,
    RejectedClaimsAuditComponent,
    ReviewCoverageComponent,
    FindingCardComponent,
    PipelineStageListComponent,
    ReviewerRunCardComponent,
    ReviewWarningListComponent,
  ],
  template: `
    <div class="report-page-container">
      @if (loading()) {
        <div class="loading-state font-mono">
          <span class="loading-spinner"></span>
          <span>Loading review orchestration state...</span>
        </div>
      } @else if (error()) {
        <div class="error-banner font-mono" role="alert">
          <div class="error-header-row">
            <span class="error-glyph">⚠</span>
            <span class="error-title font-mono">{{ errorTitle() }}</span>
          </div>
          <p class="error-desc">{{ error() }}</p>

          @if (isDataConsistencyError()) {
            <p class="consistency-note">
              The review job completed, but the server has no stored report artifact available at this time.
            </p>
          }

          <div class="error-nav-actions font-mono">
            <button class="btn btn-secondary font-mono" (click)="loadReportData()">Retry</button>
            @if (isDataConsistencyError() && job()) {
              <button class="btn btn-secondary font-mono" (click)="showPipelineDetails.set(!showPipelineDetails())">
                {{ showPipelineDetails() ? 'Hide Pipeline Details' : 'View Pipeline Details' }}
              </button>
            }
            <a routerLink="/reviews/history" class="btn btn-secondary font-mono">Review History</a>
            <a routerLink="/reviews/new" class="btn btn-primary font-mono">New Review</a>
            @if (activeBackendJobId()) {
              <a [routerLink]="['/reviews', activeBackendJobId()]" class="btn btn-accent font-mono">
                Open ongoing review →
              </a>
            }
          </div>
        </div>

        @if (showPipelineDetails() && job()) {
          <div class="consistency-details">
            <app-pipeline-stage-list [stages]="stageStatuses()" />
            <app-review-warning-list [warnings]="warnings()" />
          </div>
        }
      } @else if (job()) {
        <!-- Top Action Bar -->
        <div class="top-bar">
          <div class="header-left">
            <div class="breadcrumbs font-mono">
              <a routerLink="/reviews/history" class="back-link">← History</a>
              <span>/</span>
              <span class="active">PR #{{ job()!.pullRequest.pullRequestId }}</span>
              <span class="job-badge font-mono">#job-{{ job()!.id.slice(0, 8) }}</span>
            </div>

            <div class="title-row">
              <h1 class="page-title">
                PR #{{ job()!.pullRequest.pullRequestId }}: {{ job()!.pullRequest.title }}
              </h1>
              <div class="status-pill font-mono" [class]="'state-' + job()!.state">
                <span class="pulse-dot" *ngIf="isInProgress()"></span>
                <span>Stage: {{ job()!.state | uppercase }}</span>
              </div>
            </div>
          </div>

          <div class="action-buttons">
            @if (isInProgress()) {
              @if (canCancel()) {
                <button
                  id="cancel-review-btn"
                  type="button"
                  class="btn btn-danger font-mono"
                  [disabled]="cancelling()"
                  (click)="onCancel()"
                >
                  <span>✕</span>
                  <span>{{ cancelling() ? 'Cancelling...' : 'Cancel Review' }}</span>
                </button>
              }
            } @else if (job()!.state === 'completed' && report()) {
              <button
                class="btn btn-secondary font-mono"
                (click)="copyMarkdown()"
                [disabled]="copying()"
                aria-label="Copy Markdown report to clipboard"
              >
                {{ copySuccess() ? '✓ Copied!' : 'Copy Markdown' }}
              </button>
              <button
                class="btn btn-secondary font-mono"
                (click)="downloadMarkdown()"
                aria-label="Download Markdown report file"
              >
                Download .md
              </button>
              <a routerLink="/reviews/new" class="btn btn-primary font-mono">New Review</a>
            } @else {
              <a routerLink="/reviews/new" class="btn btn-primary font-mono">New Review</a>
            }
          </div>
        </div>

        <!-- Action Error Banner -->
        @if (actionError()) {
          <div class="action-error-banner font-mono" role="alert">
            <span class="error-msg">⚠ {{ actionError() }}</span>
            <div class="error-actions">
              <button class="btn btn-secondary btn-sm" (click)="retryLastAction()">Retry</button>
              <button class="btn-dismiss" (click)="actionError.set(null)" aria-label="Dismiss error">✕</button>
            </div>
          </div>
        }

        @if (job()!.verifier; as verifier) {
          <section class="reviewers-section" aria-label="Main verifier activity">
            <h2 class="section-title">Main Verifier</h2>
            <app-reviewer-run-card [run]="verifier" [isVerifier]="true" />
          </section>
        }
        @if (job()!.state === 'completed' || job()!.state === 'cancelled') {
          <section class="reviewers-section" aria-label="Reviewer activity">
            <h2 class="section-title">Reviewer Activity</h2>
            <div class="reviewers-grid">
              @for (run of job()!.reviewers; track run.id) {
                <app-reviewer-run-card [run]="run" />
              }
            </div>
          </section>
        }
        <!-- CASE 1: IN-PROGRESS ACTIVE PIPELINE -->
        @if (isInProgress()) {
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
              <span class="telemetry-val">{{ job()!.main.model }}</span>
            </div>
            <div class="telemetry-cell">
              <span class="telemetry-label">BRANCH</span>
              <span class="telemetry-val truncate" [title]="job()!.pullRequest.sourceBranch">
                {{ job()!.pullRequest.sourceBranch }}
              </span>
            </div>
          </div>

          <app-pipeline-stage-list [stages]="stageStatuses()" />
          <app-review-warning-list [warnings]="warnings()" />

          <div class="reviewers-section">
            <div class="section-title-row">
              <h2 class="section-title">Parallel Reviewer Models ({{ job()!.reviewers.length }})</h2>
              <span class="font-mono text-muted text-xs">ISOLATED PROCESS EXECUTION</span>
            </div>

            <div class="reviewers-grid">
              @for (run of job()!.reviewers; track run.id) {
                <app-reviewer-run-card [run]="run" />
              }
            </div>
          </div>
        }

        <!-- CASE 2: FAILED STATE -->
        @else if (job()!.state === 'failed') {
          <div class="failed-banner font-mono" role="alert">
            <span class="banner-icon">⚠</span>
            <div class="banner-content">
              <strong>Review Pipeline Execution Failed</strong>
              <p>{{ failureWarning() || 'The review orchestration pipeline encountered a failure during execution.' }}</p>
              @if (failedStage()) {
                <div class="failure-detail">
                  <span class="detail-label">Failed Stage:</span>
                  <span class="detail-val">{{ failedStage() }}</span>
                </div>
              }
              @if (failedReviewers().length > 0) {
                <div class="failure-detail">
                  <span class="detail-label">Failed Reviewers:</span>
                  <span class="detail-val">{{ failedReviewers().join(', ') }}</span>
                </div>
              }
            </div>
            <div class="banner-actions ml-auto">
              <a routerLink="/reviews/new" class="btn btn-primary font-mono">Start Another Review</a>
              <a routerLink="/reviews/history" class="btn btn-secondary font-mono">History</a>
            </div>
          </div>

          <div class="telemetry-strip font-mono">
            <div class="telemetry-cell">
              <span class="telemetry-label">ISOLATION</span>
              <span class="telemetry-val">Read-only temp mount</span>
            </div>
            <div class="telemetry-cell">
              <span class="telemetry-label">VERIFIER</span>
              <span class="telemetry-val">{{ job()!.main.model }}</span>
            </div>
            <div class="telemetry-cell">
              <span class="telemetry-label">STATUS</span>
              <span class="telemetry-val text-danger">EXECUTION FAILED</span>
            </div>
            <div class="telemetry-cell">
              <span class="telemetry-label">BRANCH</span>
              <span class="telemetry-val truncate">{{ job()!.pullRequest.sourceBranch }}</span>
            </div>
          </div>

          <app-pipeline-stage-list [stages]="stageStatuses()" />
          <app-review-warning-list [warnings]="warnings()" />

          <div class="reviewers-section">
            <div class="section-title-row">
              <h2 class="section-title">Reviewer Unit Diagnostics</h2>
            </div>
            <div class="reviewers-grid">
              @for (run of job()!.reviewers; track run.id) {
                <app-reviewer-run-card [run]="run" />
              }
            </div>
          </div>
        }

        <!-- CASE 3: CANCELLED STATE -->
        @else if (job()!.state === 'cancelled') {
          <div class="cancelled-banner font-mono" role="alert">
            <span class="banner-icon">⊘</span>
            <div class="banner-content">
              <strong>Review Cancelled</strong>
              <p>Review orchestration was cancelled. Child CLI processes were terminated.</p>
            </div>
            <div class="banner-actions ml-auto">
              <a routerLink="/reviews/new" class="btn btn-primary font-mono">Start Another Review</a>
              <a routerLink="/reviews/history" class="btn btn-secondary font-mono">History</a>
            </div>
          </div>

          <app-pipeline-stage-list [stages]="stageStatuses()" />
          <app-review-warning-list [warnings]="warnings()" />
        }

        <!-- CASE 4: COMPLETED WITH REPORT -->
        @else if (job()!.state === 'completed' && report()) {
          <div class="report-layout">
            <main class="report-main-content">
              <app-report-metadata [job]="job()!" [report]="report()!"></app-report-metadata>

              <section id="summary" class="report-section summary-section">
                <h2 class="section-heading font-mono">EXECUTIVE SUMMARY</h2>
                <div class="executive-summary-body">
                  <p class="summary-text">{{ report()!.executiveSummary }}</p>
                </div>
              </section>

              <section id="findings" class="report-section findings-section">
                <div class="section-header">
                  <h2 class="section-heading font-mono">
                    VERIFIED FINDINGS ({{ report()!.findings.length }})
                  </h2>
                  <span class="section-subtext font-mono">
                    Filtered and verified against codebase by {{ job()!.main.model }}
                  </span>
                </div>

                @if (sortedFindings().length === 0) {
                  <div class="clean-state-card font-mono">
                    <div class="clean-icon">✓</div>
                    <h3 class="clean-title">No Verified Findings</h3>
                    <p class="clean-desc">
                      The verifier engine reviewed all candidate claims submitted by parallel models and found zero valid security vulnerabilities or code defects in this pull request.
                    </p>
                  </div>
                } @else {
                  <div class="findings-list">
                    @for (finding of sortedFindings(); track finding.id) {
                      <app-finding-card [finding]="finding"></app-finding-card>
                    }
                  </div>
                }
              </section>

              @if (report()!.coverage && report()!.coverage!.length > 0) {
                <app-review-coverage [coverage]="report()!.coverage!"></app-review-coverage>
              }

              <app-rejected-claims-audit [decisions]="report()!.decisions"></app-rejected-claims-audit>

              @if (report()!.exclusions.length > 0) {
                <section id="exclusions" class="report-section aux-section">
                  <h3 class="aux-heading font-mono">SCOPE EXCLUSIONS</h3>
                  <div class="exclusions-list">
                    @for (ex of report()!.exclusions; track ex.path) {
                      <div class="exclusion-row font-mono">
                        <span class="exclusion-path">{{ ex.path }}</span>
                        <span class="exclusion-reason">{{ ex.reason }}</span>
                      </div>
                    }
                  </div>
                </section>
              }

              @if (report()!.warnings.length > 0) {
                <section id="warnings" class="report-section aux-section">
                  <h3 class="aux-heading font-mono">WARNINGS & FALLBACK NOTICES</h3>
                  <div class="warnings-list">
                    @for (warning of report()!.warnings; track $index) {
                      <div class="warning-row font-mono">
                        <span class="warning-bullet">⚠</span>
                        <span>{{ warning }}</span>
                      </div>
                    }
                  </div>
                </section>
              }
            </main>

            <aside class="report-sidebar">
              <app-report-toc
                [findings]="sortedFindings()"
                [decisions]="report()!.decisions"
                [exclusions]="report()!.exclusions"
                [warnings]="report()!.warnings"
                [hasCoverage]="hasCoverage()"
              ></app-report-toc>
            </aside>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .report-page-container {
      max-width: 1300px;
      margin: 0 auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid $border-subtle;
    }

    .header-left {
      display: flex;
      flex-direction: column;
      gap: 6px;
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
    }

    .page-title {
      font-size: 20px;
      font-weight: 700;
      color: $text-primary;
      margin: 0;
    }

    .status-pill {
      font-family: $font-mono;
      font-size: 11px;
      font-weight: 500;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background-color: $bg-surface-2;
      border: 1px solid $border-subtle;
      color: $text-secondary;

      &.state-reviewing, &.state-verifying, &.state-rendering, &.state-preparing, &.state-queued {
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
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }

    .action-buttons {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-shrink: 0;
    }

    .btn {
      font-size: 11px;
      padding: 8px 14px;
      border-radius: 6px;
      border: 1px solid transparent;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      text-decoration: none;

      &.btn-primary, &.btn-accent {
        background-color: $accent-primary;
        color: #002b3d;
        font-weight: 600;
      }
      &.btn-secondary {
        background-color: $bg-surface-3;
        color: $text-primary;
        border-color: $border-default;
      }
      &.btn-danger {
        background-color: rgba(248, 81, 73, 0.15);
        color: $severity-critical;
        border-color: rgba(248, 81, 73, 0.4);
        &:hover { background-color: rgba(248, 81, 73, 0.25); }
      }
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

    .telemetry-val { color: $text-primary; }
    .text-success { color: $status-clean; }
    .text-danger { color: $severity-critical; }

    .reviewers-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .section-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: $text-primary;
      margin: 0;
    }

    .reviewers-grid {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .failed-banner, .cancelled-banner {
      border-radius: 6px;
      padding: 16px 20px;
      display: flex;
      gap: 14px;
      font-size: 13px;

      .banner-icon { font-size: 20px; }
      .banner-content { display: flex; flex-direction: column; gap: 4px; }
      p { margin: 2px 0 0 0; }
    }

    .failed-banner {
      background-color: rgba(248, 81, 73, 0.12);
      border: 1px solid rgba(248, 81, 73, 0.3);
      align-items: flex-start;
      color: #ffdad6;

      .banner-icon { color: $severity-critical; }
      p { color: #ffb4ab; }
      .failure-detail { font-size: 12px; margin-top: 4px; }
      .detail-label { color: $text-muted; margin-right: 6px; }
      .detail-val { color: $text-primary; font-weight: 600; }
    }

    .cancelled-banner {
      background-color: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.3);
      align-items: center;
      color: $severity-medium;

      p { color: $text-secondary; }
    }

    .banner-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      white-space: nowrap;
    }

    .report-layout {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;

      @media (min-width: 1024px) {
        grid-template-columns: 1fr 260px;
      }
    }

    .report-main-content {
      display: flex;
      flex-direction: column;
      gap: 24px;
      min-width: 0;
    }

    .report-sidebar {
      display: none;
      @media (min-width: 1024px) {
        display: block;
      }
    }

    .report-section {
      @include card-surface;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid $border-subtle;
      padding-bottom: 8px;
    }

    .section-heading {
      font-size: 12px;
      font-weight: 700;
      color: $text-secondary;
      letter-spacing: 0.05em;
    }

    .section-subtext {
      font-size: 10px;
      color: $text-muted;
    }

    .summary-text {
      font-size: 14px;
      line-height: 1.6;
      color: $text-primary;
    }

    .clean-state-card {
      background-color: rgba(63, 185, 80, 0.05);
      border: 1px solid rgba(63, 185, 80, 0.3);
      border-radius: 8px;
      padding: 32px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;

      .clean-icon { font-size: 28px; color: $status-clean; }
      .clean-title { font-size: 16px; font-weight: 700; color: $status-clean; }
      .clean-desc { font-size: 12px; color: $text-secondary; max-width: 500px; }
    }

    .findings-list, .exclusions-list, .warnings-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .exclusions-list, .warnings-list { gap: 8px; }

    .aux-heading {
      font-size: 11px;
      font-weight: 700;
      color: $text-muted;
      letter-spacing: 0.05em;
    }

    .exclusion-row {
      display: flex;
      gap: 12px;
      font-size: 11px;
      background: $bg-surface-2;
      padding: 6px 12px;
      border-radius: 4px;
      .exclusion-path { color: $accent-primary; font-weight: 600; }
      .exclusion-reason { color: $text-muted; }
    }

    .warning-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: $severity-medium;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.2);
      padding: 8px 12px;
      border-radius: 4px;
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 48px;
      color: $text-muted;
    }

    .loading-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid $border-subtle;
      border-top-color: $accent-primary;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .error-banner {
      @include card-surface;
      border-color: rgba(248, 81, 73, 0.4);
      background: rgba(248, 81, 73, 0.05);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      align-items: flex-start;

      .error-header-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .error-glyph { font-size: 16px; color: $severity-critical; }
      .error-title { font-size: 12px; color: $severity-critical; font-weight: 700; }
      .error-desc { font-size: 13px; color: $text-primary; margin: 0; }
      .consistency-note { font-size: 12px; color: $text-secondary; margin: 0; }
    }

    .error-nav-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-top: 6px;
    }

    .consistency-details {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-top: 8px;
    }

    .action-error-banner {
      background: rgba(248, 81, 73, 0.1);
      border: 1px solid rgba(248, 81, 73, 0.3);
      border-radius: 6px;
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      color: $severity-critical;
      font-size: 12px;

      .error-msg { font-weight: 500; }
      .error-actions { display: flex; align-items: center; gap: 8px; }
      .btn-sm { padding: 4px 10px; font-size: 11px; }
      .btn-dismiss {
        background: transparent;
        border: none;
        color: $text-muted;
        cursor: pointer;
        font-size: 14px;
        padding: 4px;
        &:hover { color: $text-primary; }
      }
    }

    .truncate { @include truncate; }
    .font-mono { font-family: $font-mono; }
    .ml-auto { margin-left: auto; }
  `],
})
export class ReportPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly apiClient = inject(ApiClientService);
  private readonly reportIntegration = inject(ReportIntegrationService);
  private readonly eventsService = inject(ReviewEventsService);
  private readonly router = inject(Router);

  private readonly activityStore = inject(ActiveReviewStore);
  readonly job = this.activityStore.job;
  readonly report = signal<VerifiedReportWithCoverage | null>(null);
  readonly hasCoverage = computed(() => {
    const cov = this.report()?.coverage;
    return !!(cov && cov.length > 0 && cov.some((r) => r.areas && r.areas.length > 0));
  });
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly errorType = signal<'not_found' | 'network' | 'auth' | 'data_consistency' | 'generic' | null>(null);
  readonly isDataConsistencyError = signal<boolean>(false);
  readonly activeBackendJobId = signal<string | null>(null);
  readonly showPipelineDetails = signal<boolean>(false);
  readonly cancelling = signal<boolean>(false);

  readonly copying = signal<boolean>(false);
  readonly copySuccess = signal<boolean>(false);
  readonly actionError = signal<string | null>(null);
  private lastAction: 'copy' | 'download' | null = null;
  private currentRequestId = 0;
  private eventSubscription: Subscription | null = null;

  readonly sortedFindings = computed<ReviewFinding[]>(() => {
    const findings = this.report()?.findings ?? [];
    return [...findings].sort((a, b) => {
      const weightA = SEVERITY_WEIGHT[a.severity] ?? 0;
      const weightB = SEVERITY_WEIGHT[b.severity] ?? 0;
      return weightB - weightA;
    });
  });

  readonly isInProgress = computed<boolean>(() => {
    const s = this.job()?.state;
    return !!s && ['queued', 'preparing', 'reviewing', 'verifying', 'rendering', 'cancelling'].includes(s);
  });

  readonly canCancel = computed<boolean>(() => {
    const j = this.job();
    if (!j) return false;
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(j.state);
    return !isTerminal && j.state !== 'cancelling' && !this.cancelling();
  });

  readonly warnings = computed<string[]>(() => {
    return this.job()?.warnings ?? [];
  });

  readonly failedReviewers = computed<string[]>(() => {
    const reviewers = this.job()?.reviewers ?? [];
    return reviewers
      .filter((r) => r.state === 'failed' || r.state === 'timed_out')
      .map((r) => `${r.selection.model} (${r.selection.provider})`);
  });

  readonly failedStage = computed<string | null>(() => {
    if (this.job()?.state !== 'failed') return null;
    const stages = this.stageStatuses();
    const failed = stages.find((s) => s.status === 'failed');
    return failed ? `${failed.step}. ${failed.name} (${failed.desc})` : 'Orchestration Pipeline';
  });

  readonly errorTitle = computed<string>(() => {
    if (this.isDataConsistencyError()) return 'FAILED TO LOAD REPORT — DATA CONSISTENCY ERROR';
    if (this.errorType() === 'not_found') return 'REVIEW NOT FOUND';
    if (this.errorType() === 'network') return 'NETWORK ERROR';
    if (this.errorType() === 'auth') return 'AUTHENTICATION ERROR';
    return 'FAILED TO LOAD REPORT';
  });

  readonly failureWarning = computed<string | null>(() => {
    const ws = this.warnings();
    for (let i = ws.length - 1; i >= 0; i--) {
      if (/^Failed during/i.test(ws[i])) {
        return ws[i];
      }
    }
    return null;
  });

  readonly stageStatuses = computed<StageInfo[]>(() => {
    return calculateStageStatuses(this.job(), this.warnings());
  });

  private routeSubscription: Subscription | null = null;

  ngOnInit(): void {
    if (this.route.paramMap && typeof (this.route.paramMap as any).subscribe === 'function') {
      this.routeSubscription = this.route.paramMap.subscribe((params) => {
        const reviewId = params?.get?.('reviewId');
        if (reviewId) {
          this.loadReportData(reviewId);
        }
      });
    }

    const snapshotId = this.route.snapshot?.paramMap?.get('reviewId');
    if (snapshotId && !this.job() && !this.loading()) {
      this.loadReportData(snapshotId);
    }
  }

  ngOnDestroy(): void {
    this.activityStore.stopTicker();
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
      this.routeSubscription = null;
    }
    this.disconnectEvents();
  }

  async loadReportData(id?: string): Promise<void> {
    const reviewId = id ?? this.route.snapshot?.paramMap?.get('reviewId');
    if (!reviewId) {
      this.error.set('No review ID provided');
      this.errorType.set('generic');
      this.loading.set(false);
      return;
    }

    const requestId = ++this.currentRequestId;
    this.disconnectEvents();
    this.loading.set(true);
    this.error.set(null);
    this.errorType.set(null);
    this.isDataConsistencyError.set(false);

    if (this.job()?.id !== reviewId) {
      this.job.set(null);
      this.report.set(null);
    }

    // Non-blocking query to see if another job is active on backend
    this.checkActiveBackendJob(reviewId);

    try {
      // 1. Fetch Job
      const jobData = await this.apiClient.request<ReviewJob>({
        method: 'GET',
        path: `/api/reviews/${reviewId}`,
        schema: ReviewJobSchema,
      });

      if (requestId !== this.currentRequestId) return;

      this.activityStore.replaceSnapshot(jobData);
      this.activityStore.startTicker();

      // 2. State-dependent loading
      if (['queued', 'preparing', 'reviewing', 'verifying', 'rendering', 'cancelling'].includes(jobData.state)) {
        // Active pipeline: do not call report endpoint
        this.report.set(null);
        this.subscribeToEvents(reviewId, requestId);
        return;
      }

      if (jobData.state === 'failed' || jobData.state === 'cancelled') {
        // Terminal failure / cancellation: no report expected
        this.report.set(null);
        return;
      }

      // 3. Completed state: fetch structured report
      try {
        const reportData = await this.reportIntegration.getStructuredReport(reviewId);
        if (requestId !== this.currentRequestId) return;
        this.report.set(reportData);
      } catch (reportErr: unknown) {
        if (requestId !== this.currentRequestId) return;
        this.report.set(null);

        if (reportErr instanceof ApiError) {
          if (reportErr.code === 'SCHEMA_VALIDATION_ERROR') {
            this.job.set(null);
            this.errorType.set('generic');
            this.error.set(reportErr.message);
          } else if (reportErr.statusCode === 404) {
            this.isDataConsistencyError.set(true);
            this.errorType.set('data_consistency');
            this.error.set(reportErr.message || 'No report is available for this review.');
          } else if (reportErr.statusCode === 401) {
            this.errorType.set('auth');
            this.error.set(reportErr.message || 'Authentication required.');
          } else if (reportErr.statusCode === 0) {
            this.errorType.set('network');
            this.error.set('Network connection failed while loading report.');
          } else {
            this.errorType.set('generic');
            this.error.set(reportErr.message || 'Failed to load report.');
          }
        } else {
          this.job.set(null);
          this.errorType.set('generic');
          this.error.set(reportErr instanceof Error ? reportErr.message : 'Unknown error loading report');
        }
      }
    } catch (err: unknown) {
      if (requestId !== this.currentRequestId) return;
      this.job.set(null);
      this.report.set(null);

      if (err instanceof ApiError) {
        if (err.statusCode === 404) {
          this.errorType.set('not_found');
          this.error.set(`Review not found: The review with ID "${reviewId}" does not exist.`);
        } else if (err.statusCode === 401) {
          this.errorType.set('auth');
          this.error.set(err.message || 'Authentication required.');
        } else if (err.statusCode === 0) {
          this.errorType.set('network');
          this.error.set('Network connection error: Unable to reach the orchestrator server.');
        } else {
          this.errorType.set('generic');
          this.error.set(err.message || 'Failed to load review.');
        }
      } else {
        this.errorType.set('generic');
        this.error.set(err instanceof Error ? err.message : 'Unknown error loading report');
      }
    } finally {
      if (requestId === this.currentRequestId) {
        this.loading.set(false);
      }
    }
  }

  private async checkActiveBackendJob(currentReviewId: string): Promise<void> {
    try {
      const active = await this.apiClient.request<ReviewJob | null>({
        method: 'GET',
        path: '/api/reviews/active',
        schema: ReviewJobSchema.nullable(),
      });
      if (
        active &&
        active.id &&
        active.id !== currentReviewId &&
        !['completed', 'failed', 'cancelled'].includes(active.state)
      ) {
        this.activeBackendJobId.set(active.id);
      } else {
        this.activeBackendJobId.set(null);
      }
    } catch {
      this.activeBackendJobId.set(null);
    }
  }

  private subscribeToEvents(reviewId: string, requestId: number): void {
    this.disconnectEvents();

    this.eventSubscription = this.eventsService.connect(reviewId).subscribe({
      next: (event: ReviewEvent) => {
        if (requestId !== this.currentRequestId) return;
        this.applyEvent(event);
      },
      error: () => {
        // SSE service handles reconnect automatically
      },
    });
  }

  private applyEvent(event: ReviewEvent): void {
    if (this.job()?.id && event.reviewId !== this.job()?.id) {
      return;
    }

    switch (event.type) {
      case 'job.snapshot':
        this.activityStore.replaceSnapshot(event.payload.job);
        if (event.payload.job.state === 'completed') {
          this.disconnectEvents();
          this.loadReportData(event.payload.job.id);
        } else if (['failed', 'cancelled'].includes(event.payload.job.state)) {
          this.disconnectEvents();
        }
        break;

      case 'job.state_changed':
        this.job.update((current) => (current ? { ...current, state: event.payload.state } : null));
        if (event.payload.state === 'completed') {
          this.disconnectEvents();
          this.loadReportData(this.job()?.id ?? event.reviewId);
        } else if (['failed', 'cancelled'].includes(event.payload.state)) {
          this.disconnectEvents();
        }
        break;

      case 'reviewer.state_changed':
      case 'run.activity':
      case 'run.heartbeat':
        this.activityStore.applyEvent(event);
        break;

      case 'job.warning':
        this.job.update((current) => {
          if (!current) return null;
          return {
            ...current,
            warnings: [...current.warnings, event.payload.message],
          };
        });
        break;
    }
  }

  private disconnectEvents(): void {
    if (this.eventSubscription) {
      this.eventSubscription.unsubscribe();
      this.eventSubscription = null;
    }
    this.eventsService.disconnect();
  }

  async onCancel(): Promise<void> {
    const currentJob = this.job();
    if (!currentJob || !this.canCancel()) return;

    this.cancelling.set(true);
    try {
      const updated = await this.apiClient.request<ReviewJob>({
        method: 'POST',
        path: `/api/reviews/${currentJob.id}/cancel`,
        schema: ReviewJobSchema,
      });
      this.job.set(updated);
    } catch (err: unknown) {
      this.actionError.set(err instanceof Error ? err.message : 'Failed to cancel review');
    } finally {
      this.cancelling.set(false);
    }
  }

  async copyMarkdown(): Promise<void> {
    const reviewId = this.job()?.id;
    if (!reviewId) return;

    this.copying.set(true);
    this.actionError.set(null);
    this.lastAction = 'copy';

    try {
      const mdContent = await this.apiClient.requestText({
        method: 'GET',
        path: `/api/reviews/${reviewId}/report.md`,
      });

      await navigator.clipboard.writeText(mdContent);
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2500);
    } catch (err: unknown) {
      this.copySuccess.set(false);
      const msg = err instanceof Error ? err.message : 'Failed to copy Markdown report';
      this.actionError.set(`Copy failed: ${msg}. You can retry.`);
    } finally {
      this.copying.set(false);
    }
  }

  async downloadMarkdown(): Promise<void> {
    const reviewId = this.job()?.id;
    if (!reviewId) return;

    this.actionError.set(null);
    this.lastAction = 'download';

    try {
      const mdContent = await this.apiClient.requestText({
        method: 'GET',
        path: `/api/reviews/${reviewId}/report.md`,
      });

      const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pr-review-${this.job()?.pullRequest.pullRequestId ?? reviewId}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to download Markdown report';
      this.actionError.set(`Download failed: ${msg}. You can retry.`);
    }
  }

  retryLastAction(): void {
    if (this.lastAction === 'copy') {
      this.copyMarkdown();
    } else if (this.lastAction === 'download') {
      this.downloadMarkdown();
    }
  }
}
