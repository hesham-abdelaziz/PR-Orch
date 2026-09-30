import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReviewFinding } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-finding-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="finding-card" [id]="finding.id">
      <!-- Severity & Title -->
      <div class="finding-top-row">
        <div class="finding-badge-group">
          <span class="badge-severity font-mono" [class]="'sev-' + finding.severity">
            {{ finding.severity | uppercase }}
          </span>
          <h3 class="finding-title">{{ finding.title }}</h3>
        </div>

        <!-- Reviewer Origins Pills -->
        <div class="finding-origins">
          <span class="origins-label font-mono">ORIGINS:</span>
          <div class="origins-pills">
            @for (origin of finding.origins; track $index) {
              <span class="origin-pill font-mono">
                <span class="provider-glyph" [class]="origin.provider">●</span>
                {{ origin.model }}
              </span>
            }
          </div>
        </div>
      </div>

      <!-- Code Location -->
      <div class="finding-location-row font-mono">
        <span class="meta-label">LOCATION:</span>
        <span class="location-code">
          {{ finding.filePath }}:{{ finding.location.startLine }}-{{ finding.location.endLine }}
        </span>
      </div>

      <!-- Evidence -->
      <div class="finding-detail-block">
        <span class="detail-label font-mono">EVIDENCE:</span>
        <div class="detail-body evidence-box">
          <code>{{ finding.evidence }}</code>
        </div>
      </div>

      <!-- Impact -->
      <div class="finding-detail-block">
        <span class="detail-label font-mono">IMPACT:</span>
        <div class="detail-body">
          <p class="impact-text">{{ finding.impact }}</p>
        </div>
      </div>

      <!-- Suggested Fix -->
      <div class="finding-detail-block">
        <span class="detail-label font-mono">SUGGESTED FIX:</span>
        <div class="detail-body fix-box">
          <p class="fix-text">{{ finding.suggestedFix }}</p>
        </div>
      </div>

      <!-- Reference (optional) -->
      @if (finding.reference) {
        <div class="finding-detail-block">
          <span class="detail-label font-mono">REFERENCE:</span>
          <div class="detail-body">
            <span class="reference-tag font-mono">{{ finding.reference }}</span>
          </div>
        </div>
      }
    </article>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .finding-card {
      background-color: $bg-surface-2;
      border: 1px solid $border-subtle;
      border-radius: 8px;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .finding-top-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }

    .finding-badge-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }

    .badge-severity {
      @include mono-badge;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;

      &.sev-critical { background: rgba(248, 81, 73, 0.15); color: $severity-critical; border: 1px solid rgba(248, 81, 73, 0.4); }
      &.sev-high { background: rgba(249, 115, 22, 0.15); color: $severity-high; border: 1px solid rgba(249, 115, 22, 0.4); }
      &.sev-medium { background: rgba(245, 158, 11, 0.15); color: $severity-medium; border: 1px solid rgba(245, 158, 11, 0.4); }
      &.sev-low { background: rgba(56, 189, 248, 0.15); color: $accent-primary; border: 1px solid rgba(56, 189, 248, 0.4); }
    }

    .finding-title {
      font-size: 14px;
      font-weight: 600;
      color: $text-primary;
    }

    .finding-origins {
      display: flex;
      align-items: center;
      gap: 6px;
      .origins-label { font-size: 10px; color: $text-muted; }
      .origins-pills { display: flex; gap: 6px; }
      .origin-pill {
        @include mono-badge;
        background: $bg-surface-3;
        color: $text-secondary;
        font-size: 10px;
      }
    }

    .provider-glyph {
      font-size: 8px;
      &.claude { color: $provider-claude; }
      &.codex { color: $provider-codex; }
      &.gemini { color: $provider-gemini; }
    }

    .finding-location-row {
      display: flex;
      gap: 8px;
      font-size: 11px;
      background: $bg-surface-1;
      padding: 6px 10px;
      border-radius: 4px;
      border: 1px solid $border-subtle;
      .meta-label { color: $text-muted; font-size: 10px; }
      .location-code { color: $accent-primary; }
    }

    .finding-detail-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
      .detail-label { font-size: 10px; color: $text-muted; }
      .detail-body { font-size: 12px; color: $text-primary; }
      .evidence-box {
        background: $bg-surface-1;
        border: 1px solid $border-subtle;
        border-radius: 4px;
        padding: 8px 12px;
        code { font-family: $font-mono; font-size: 11px; color: $text-primary; }
      }
      .fix-box {
        background: rgba(56, 189, 248, 0.05);
        border-left: 2px solid $accent-primary;
        padding: 6px 12px;
      }
      .reference-tag { font-size: 11px; color: $accent-primary; }
    }

    .font-mono { font-family: $font-mono; }
  `],
})
export class FindingCardComponent {
  @Input({ required: true }) finding!: ReviewFinding;
}
