import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { StandardsMetadata } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-standards-status',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="standards-box">
      <div class="standards-header">
        <div class="title-cluster">
          <span class="standards-icon">§</span>
          <h3>Engineering Standards</h3>
        </div>
        @if (standards) {
          <span class="badge badge-enforced font-mono">ENFORCED</span>
        } @else {
          <span class="badge badge-fallback font-mono">FALLBACK ACTIVE</span>
        }
      </div>

      @if (loading) {
        <div class="loading-hint font-mono">Loading standards...</div>
      } @else if (standards) {
        <div class="standards-content">
          <div class="file-row">
            <span class="filename font-mono truncate" [title]="standards.filename">
              {{ standards.filename }}
            </span>
            <span class="filesize font-mono">{{ formatBytes(standards.sizeBytes) }}</span>
          </div>

          <div class="hash-box font-mono" [title]="standards.sha256">
            sha256:{{ standards.sha256.slice(0, 16) }}...{{ standards.sha256.slice(-8) }}
          </div>

          <div class="notice-text">
            Active version snapshotted at job creation. Replacing the file later will not alter this report.
          </div>

          <div class="action-links">
            <a routerLink="/standards" class="link-btn">
              <span>View or replace standards</span>
              <span>→</span>
            </a>
          </div>
        </div>
      } @else {
        <div class="fallback-warning" role="alert">
          <div class="warning-title-row">
            <span class="warning-glyph">⚠</span>
            <span class="warning-title">No standards file uploaded</span>
          </div>
          <p class="warning-body">
            Reviews will use detected framework and library best-practice guidance as a fallback. An amber warning will be recorded in the final report.
          </p>
          <div class="action-links">
            <a routerLink="/standards" class="upload-link">
              <span>Upload standards file (.md / .txt)</span>
              <span>→</span>
            </a>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .standards-box {
      @include card-surface;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .standards-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .title-cluster {
      display: flex;
      align-items: center;
      gap: 8px;

      .standards-icon {
        font-size: 16px;
        color: $accent-primary;
      }

      h3 {
        font-size: 14px;
        font-weight: 600;
        color: $text-primary;
      }
    }

    .badge {
      @include mono-badge;
    }

    .badge-enforced {
      background-color: rgba(63, 185, 80, 0.15);
      color: $status-clean;
      border: 1px solid rgba(63, 185, 80, 0.3);
    }

    .badge-fallback {
      background-color: rgba(245, 158, 11, 0.15);
      color: $severity-medium;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .standards-content {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .file-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
    }

    .filename {
      color: $text-primary;
      font-weight: 500;
      max-width: 220px;
    }

    .filesize {
      color: $text-muted;
      font-size: 11px;
    }

    .hash-box {
      background-color: $bg-surface-1;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 11px;
      color: $text-secondary;
      border: 1px solid $border-subtle;
      word-break: break-all;
    }

    .notice-text {
      font-size: 11px;
      color: $text-muted;
      line-height: 1.4;
    }

    .action-links {
      padding-top: 4px;
    }

    .link-btn, .upload-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: $accent-primary;
      text-decoration: none;
      transition: color 0.15s ease;

      &:hover {
        color: #7bd0ff;
        text-decoration: underline;
      }
    }

    .fallback-warning {
      background-color: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 6px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .warning-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .warning-glyph {
      color: $severity-medium;
      font-size: 14px;
    }

    .warning-title {
      font-size: 12px;
      font-weight: 600;
      color: $severity-medium;
    }

    .warning-body {
      font-size: 12px;
      color: $text-secondary;
      line-height: 1.45;
    }

    .loading-hint {
      font-size: 11px;
      color: $text-muted;
    }

    .truncate {
      @include truncate;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class StandardsStatusComponent {
  @Input() standards: StandardsMetadata | null = null;
  @Input() loading = false;

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(2)} MB`;
  }
}
