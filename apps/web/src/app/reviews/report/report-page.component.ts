import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReviewFinding, ReviewJob, VerifiedReport } from '@pr-orchestrator/contracts';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReportMetadataComponent } from './report-metadata.component';
import { ReportTocComponent } from './report-toc.component';
import { RejectedClaimsAuditComponent } from './rejected-claims-audit.component';
import { FindingCardComponent } from './finding-card.component';

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

@Component({
  selector: 'app-report-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReportMetadataComponent,
    ReportTocComponent,
    RejectedClaimsAuditComponent,
    FindingCardComponent,
  ],
  template: `
    <div class="report-page-container">
      @if (loading()) {
        <div class="loading-state font-mono">
          <span class="loading-spinner"></span>
          <span>Loading verified report...</span>
        </div>
      } @else if (error()) {
        <div class="error-banner">
          <span class="error-title font-mono">FAILED TO LOAD REPORT</span>
          <p>{{ error() }}</p>
          <button class="btn btn-secondary font-mono" (click)="loadReportData()">Retry</button>
        </div>
      } @else if (job() && report()) {
        <!-- Top Action Bar -->
        <div class="top-bar">
          <div class="header-left">
            <a routerLink="/reviews/history" class="back-link font-mono">← History</a>
            <h1 class="page-title">
              PR #{{ job()!.pullRequest.pullRequestId }}: {{ job()!.pullRequest.title }}
            </h1>
          </div>

          <div class="action-buttons">
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
            <a routerLink="/reviews/new" class="btn btn-primary font-mono">
              New Review
            </a>
          </div>
        </div>

        <!-- Main Content Grid with TOC Sidebar -->
        <div class="report-layout">
          <main class="report-main-content">
            <!-- Metadata and Risk Badge Component -->
            <app-report-metadata [job]="job()!" [report]="report()!"></app-report-metadata>

            <!-- Executive Summary -->
            <section id="summary" class="report-section summary-section">
              <h2 class="section-heading font-mono">EXECUTIVE SUMMARY</h2>
              <div class="executive-summary-body">
                <p class="summary-text">{{ report()!.executiveSummary }}</p>
              </div>
            </section>

            <!-- Verified Findings -->
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

            <!-- Rejected Claims Audit Component -->
            <app-rejected-claims-audit [decisions]="report()!.decisions"></app-rejected-claims-audit>

            <!-- Scope Exclusions (if any) -->
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

            <!-- Warnings & Fallback Notices -->
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

          <!-- TOC Sidebar -->
          <aside class="report-sidebar">
            <app-report-toc
              [findings]="sortedFindings()"
              [decisions]="report()!.decisions"
              [exclusions]="report()!.exclusions"
              [warnings]="report()!.warnings"
            ></app-report-toc>
          </aside>
        </div>
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

    .back-link {
      font-size: 11px;
      color: $text-muted;
      &:hover { color: $accent-primary; }
    }

    .page-title {
      font-size: 20px;
      font-weight: 700;
      color: $text-primary;
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

      &.btn-primary {
        background-color: $accent-primary;
        color: #002b3d;
        font-weight: 600;
      }
      &.btn-secondary {
        background-color: $bg-surface-3;
        color: $text-primary;
        border-color: $border-default;
      }
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

    .findings-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }


    .aux-heading {
      font-size: 11px;
      font-weight: 700;
      color: $text-muted;
      letter-spacing: 0.05em;
    }

    .exclusions-list, .warnings-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
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
      gap: 12px;
      align-items: flex-start;
      .error-title { font-size: 12px; color: $severity-critical; font-weight: 700; }
    }

    .font-mono { font-family: $font-mono; }
  `],
})
export class ReportPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly apiClient = inject(ApiClientService);
  private readonly router = inject(Router);

  job = signal<ReviewJob | null>(null);
  report = signal<VerifiedReport | null>(null);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);
  copying = signal<boolean>(false);
  copySuccess = signal<boolean>(false);

  sortedFindings = computed<ReviewFinding[]>(() => {
    const findings = this.report()?.findings ?? [];
    return [...findings].sort((a, b) => {
      const weightA = SEVERITY_WEIGHT[a.severity] ?? 0;
      const weightB = SEVERITY_WEIGHT[b.severity] ?? 0;
      return weightB - weightA;
    });
  });

  ngOnInit(): void {
    this.loadReportData();
  }

  async loadReportData(): Promise<void> {
    const reviewId = this.route.snapshot.paramMap.get('reviewId');
    if (!reviewId) {
      this.error.set('No review ID provided');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    try {
      const [jobData, reportData] = await Promise.all([
        this.apiClient.request<ReviewJob>({ method: 'GET', path: `/api/reviews/${reviewId}` }),
        this.apiClient.request<VerifiedReport>({ method: 'GET', path: `/api/reviews/${reviewId}/report` }),
      ]);
      this.job.set(jobData);
      this.report.set(reportData);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error loading report';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  async copyMarkdown(): Promise<void> {
    const reviewId = this.job()?.id;
    if (!reviewId) return;

    this.copying.set(true);
    try {
      let mdContent: string;
      try {
        mdContent = await this.apiClient.request<string>({
          method: 'GET',
          path: `/api/reviews/${reviewId}/report.md`,
        });
      } catch {
        mdContent = this.generateFallbackMarkdown();
      }

      await navigator.clipboard.writeText(typeof mdContent === 'string' ? mdContent : JSON.stringify(mdContent));
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2500);
    } catch {
      // Fallback
      this.copySuccess.set(false);
    } finally {
      this.copying.set(false);
    }
  }

  async downloadMarkdown(): Promise<void> {
    const reviewId = this.job()?.id;
    if (!reviewId) return;

    try {
      let mdContent: string;
      try {
        mdContent = await this.apiClient.request<string>({
          method: 'GET',
          path: `/api/reviews/${reviewId}/report.md`,
        });
      } catch {
        mdContent = this.generateFallbackMarkdown();
      }

      const text = typeof mdContent === 'string' ? mdContent : JSON.stringify(mdContent);
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pr-review-${this.job()?.pullRequest.pullRequestId ?? reviewId}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed:', e);
    }
  }

  private generateFallbackMarkdown(): string {
    const job = this.job();
    const rep = this.report();
    if (!job || !rep) return '';

    return `# PR #${job.pullRequest.pullRequestId}: ${job.pullRequest.title}\n\n` +
      `**Risk:** ${rep.overallRisk.toUpperCase()}\n` +
      `**Verifier:** ${job.main.model}\n\n` +
      `## Executive Summary\n${rep.executiveSummary}\n\n` +
      `## Verified Findings (${rep.findings.length})\n` +
      rep.findings.map(f => `### [${f.severity.toUpperCase()}] ${f.title}\n- **Location:** \`${f.filePath}:${f.location.startLine}-${f.location.endLine}\`\n- **Evidence:** ${f.evidence}\n- **Impact:** ${f.impact}\n- **Suggested Fix:** ${f.suggestedFix}`).join('\n\n');
  }
}
