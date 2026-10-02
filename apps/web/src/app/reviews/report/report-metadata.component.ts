import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReviewJob, VerifiedReport } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-report-metadata',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="metadata-card">
      <div class="header-row">
        <div class="pr-title-group">
          <span class="badge font-mono badge-pr">PR #{{ job.pullRequest.pullRequestId }}</span>
          <h2 class="pr-title truncate" [title]="job.pullRequest.title">{{ job.pullRequest.title }}</h2>
        </div>

        <div class="risk-badge font-mono" [class]="'risk-' + report.overallRisk">
          <span class="risk-icon">●</span>
          <span>{{ report.overallRisk | uppercase }} RISK</span>
        </div>
      </div>

      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label font-mono">REPOSITORY</span>
          <span class="meta-val truncate" [title]="job.pullRequest.organization + ' / ' + job.pullRequest.repository">
            {{ job.pullRequest.organization }} / {{ job.pullRequest.repository }}
          </span>
        </div>

        <div class="meta-item">
          <span class="meta-label font-mono">BRANCHES</span>
          <span class="meta-val font-mono truncate" [title]="job.pullRequest.sourceBranch + ' → ' + job.pullRequest.targetBranch">
            {{ job.pullRequest.sourceBranch }} → {{ job.pullRequest.targetBranch }}
          </span>
        </div>

        @if (hasChanges()) {
          <div class="meta-item changes-line" id="meta-changes">
            <span class="meta-label font-mono">CHANGES</span>
            <span class="meta-val font-mono">
              <span class="text-additions">+{{ job.pullRequest.additions }}</span> / <span class="text-deletions">-{{ job.pullRequest.deletions }}</span>
            </span>
          </div>
        }

        <div class="meta-item">
          <span class="meta-label font-mono">AUTHOR</span>
          <span class="meta-val truncate" [title]="job.pullRequest.author.displayName">
            {{ job.pullRequest.author.displayName }}
          </span>
        </div>

        <div class="meta-item">
          <span class="meta-label font-mono">VERIFIER ENGINE</span>
          <span class="meta-val font-mono">
            <span class="provider-glyph" [class]="job.main.provider">●</span>
            {{ job.main.model }}
          </span>
        </div>

        <div class="meta-item">
          <span class="meta-label font-mono">PARALLEL REVIEWERS</span>
          <div class="reviewers-chips">
            @for (rev of job.reviewers; track rev.id) {
              <span class="reviewer-chip font-mono">
                <span class="provider-glyph" [class]="rev.selection.provider">●</span>
                {{ rev.selection.model }}
              </span>
            }
          </div>
        </div>

        <div class="meta-item">
          <span class="meta-label font-mono">STANDARDS SNAPSHOT</span>
          <span class="meta-val font-mono">
            {{ job.standards ? job.standards.filename + ' (v' + job.standards.versionId.slice(0, 8) + ')' : 'Detected library fallback guidance' }}
          </span>
        </div>

        @if (job.repositoryGuidance; as guidance) {
          <div class="meta-item" id="meta-guidance">
            <span class="meta-label font-mono">REPOSITORY GUIDANCE</span>
            <span class="meta-val font-mono" [title]="guidance.filename + ' (' + guidance.sha256 + ', ' + formatBytes(guidance.sizeBytes) + ')'">
              <span class="guidance-name">{{ guidance.filename }}</span>
              <span class="guidance-hash"> ({{ guidance.sha256.slice(0, 8) }})</span>
              <span class="guidance-size"> · {{ formatBytes(guidance.sizeBytes) }}</span>
              <span class="sr-only">{{ guidance.sha256 }} {{ guidance.sizeBytes }} bytes</span>
            </span>
          </div>
        }
      </div>

      <!-- Findings tally strip -->
      <div class="tally-strip">
        <div class="tally-box">
          <span class="tally-num font-mono text-accepted">{{ report.acceptedCount }}</span>
          <span class="tally-label">Accepted Findings</span>
        </div>
        <div class="tally-box tally-reproduced">
          <span class="tally-num font-mono text-reproduced">{{ reproducedCount() }}</span>
          <span class="tally-label">Reproduced</span>
        </div>
        <div class="tally-box">
          <span class="tally-num font-mono text-rejected">{{ report.rejectedCount }}</span>
          <span class="tally-label">Rejected Claims</span>
        </div>
        <div class="tally-box">
          <span class="tally-num font-mono text-muted">{{ report.mergedCount }}</span>
          <span class="tally-label">Merged Claims</span>
        </div>
        <div class="tally-box">
          <span class="tally-num font-mono text-warning">{{ report.warnings.length }}</span>
          <span class="tally-label">Notices & Warnings</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .metadata-card {
      @include card-surface;
      padding: 20px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid $border-subtle;
    }

    .pr-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }

    .badge-pr {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $accent-primary;
    }

    .pr-title {
      font-size: 16px;
      font-weight: 700;
      color: $text-primary;
    }

    .risk-badge {
      @include mono-badge;
      padding: 6px 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;

      &.risk-critical {
        background-color: rgba(248, 81, 73, 0.15);
        color: $severity-critical;
        border: 1px solid rgba(248, 81, 73, 0.4);
      }

      &.risk-high {
        background-color: rgba(249, 115, 22, 0.15);
        color: $severity-high;
        border: 1px solid rgba(249, 115, 22, 0.4);
      }

      &.risk-medium {
        background-color: rgba(245, 158, 11, 0.15);
        color: $severity-medium;
        border: 1px solid rgba(245, 158, 11, 0.4);
      }

      &.risk-low {
        background-color: rgba(56, 189, 248, 0.15);
        color: $accent-primary;
        border: 1px solid rgba(56, 189, 248, 0.4);
      }

      &.risk-clean {
        background-color: rgba(63, 185, 80, 0.15);
        color: $status-clean;
        border: 1px solid rgba(63, 185, 80, 0.4);
      }
    }

    .risk-icon {
      font-size: 9px;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;

      @media (min-width: 900px) {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    .meta-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .meta-label {
      font-size: 10px;
      color: $text-muted;
      letter-spacing: 0.04em;
    }

    .meta-val {
      font-size: 12px;
      color: $text-primary;
    }

    .provider-glyph {
      font-size: 8px;
      margin-right: 2px;

      &.claude { color: $provider-claude; }
      &.codex { color: $provider-codex; }
      &.gemini { color: $provider-gemini; }
    }

    .effort-tag {
      font-size: 10px;
      color: $accent-verifier;
      margin-left: 4px;
    }

    .reviewers-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .reviewer-chip {
      @include mono-badge;
      background-color: $bg-surface-2;
      color: $text-secondary;
      font-size: 10px;
    }

    .tally-strip {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      background-color: $bg-surface-1;
      padding: 10px 14px;
      border-radius: 6px;
      border: 1px solid $border-subtle;

      @media (min-width: 768px) {
        grid-template-columns: repeat(5, 1fr);
      }
    }

    .tally-box {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .tally-num {
      font-size: 16px;
      font-weight: 700;
    }

    .tally-label {
      font-size: 11px;
      color: $text-muted;
    }

    .text-accepted { color: $severity-critical; }
    .text-reproduced { color: $accent-verifier; }
    .text-rejected { color: $status-clean; }
    .text-warning { color: $severity-medium; }
    .text-additions { color: $status-clean; }
    .text-deletions { color: $severity-critical; }

    .truncate {
      @include truncate;
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
      border: 0;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReportMetadataComponent {
  @Input({ required: true }) job!: ReviewJob;
  @Input({ required: true }) report!: VerifiedReport;

  hasChanges(): boolean {
    return (
      this.job?.pullRequest?.additions !== null &&
      this.job?.pullRequest?.additions !== undefined &&
      this.job?.pullRequest?.deletions !== null &&
      this.job?.pullRequest?.deletions !== undefined
    );
  }

  reproducedCount(): number {
    return this.report?.findings ? this.report.findings.filter((f) => !!f.probe).length : 0;
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
}
