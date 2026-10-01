import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReviewFinding, VerifierDecision } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-report-toc',
  standalone: true,
  imports: [CommonModule],
  template: `
    <nav class="report-toc" aria-label="Report table of contents">
      <div class="toc-header">
        <span class="toc-title font-mono">TABLE OF CONTENTS</span>
      </div>

      <ul class="toc-list font-mono">
        <li>
          <a href="#summary" class="toc-link">Executive Summary</a>
        </li>

        @if (findings.length > 0) {
          <li>
            <a href="#findings" class="toc-link">
              Verified Findings
              <span class="count-badge">{{ findings.length }}</span>
            </a>
            <ul class="toc-sublist">
              @for (finding of findings; track finding.id) {
                <li>
                  <a [href]="'#' + finding.id" class="toc-sublink truncate" [title]="finding.title">
                    <span class="severity-dot" [class]="'dot-' + finding.severity">●</span>
                    {{ finding.title }}
                  </a>
                </li>
              }
            </ul>
          </li>
        }

        @if (hasCoverage) {
          <li>
            <a href="#review-coverage" class="toc-link">Review Coverage</a>
          </li>
        }

        @if (decisions.length > 0) {
          <li>
            <a href="#rejected-audit" class="toc-link">
              Rejected Claims
              <span class="count-badge">{{ decisions.length }}</span>
            </a>
          </li>
        }

        @if (exclusions.length > 0) {
          <li>
            <a href="#exclusions" class="toc-link">Scope Exclusions</a>
          </li>
        }

        @if (warnings.length > 0) {
          <li>
            <a href="#warnings" class="toc-link">Warnings & Notices</a>
          </li>
        }
      </ul>
    </nav>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .report-toc {
      @include card-surface;
      padding: 16px;
      position: sticky;
      top: 24px;
      max-height: calc(100vh - 48px);
      overflow-y: auto;
    }

    .toc-header {
      padding-bottom: 8px;
      margin-bottom: 12px;
      border-bottom: 1px solid $border-subtle;
    }

    .toc-title {
      font-size: 10px;
      color: $text-muted;
      letter-spacing: 0.05em;
    }

    .toc-list, .toc-sublist {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .toc-sublist {
      padding-left: 12px;
      margin-top: 6px;
      border-left: 1px solid $border-subtle;
    }

    .toc-link, .toc-sublink {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: $text-secondary;
      text-decoration: none;
      padding: 4px 6px;
      border-radius: 4px;
      transition: background-color 0.15s ease, color 0.15s ease;

      &:hover {
        background-color: $bg-surface-2;
        color: $text-primary;
      }

      &:focus-visible {
        outline: 1px solid $accent-primary;
      }
    }

    .toc-sublink {
      font-size: 10px;
      color: $text-muted;

      &:hover {
        color: $text-primary;
      }
    }

    .count-badge {
      margin-left: auto;
      font-size: 9px;
      padding: 1px 5px;
      background-color: $bg-surface-2;
      border-radius: 10px;
      color: $text-muted;
    }

    .severity-dot {
      font-size: 8px;
      flex-shrink: 0;

      &.dot-critical { color: $severity-critical; }
      &.dot-high { color: $severity-high; }
      &.dot-medium { color: $severity-medium; }
      &.dot-low { color: $accent-primary; }
    }

    .truncate {
      @include truncate;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReportTocComponent {
  @Input() findings: ReviewFinding[] = [];
  @Input() decisions: VerifierDecision[] = [];
  @Input() exclusions: { path: string; reason: string }[] = [];
  @Input() warnings: string[] = [];
  @Input() hasCoverage = false;
}
