import { Component, Input, signal } from '@angular/core';
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
          @if (finding.probe) {
            <span class="badge-reproduced font-mono">Reproduced</span>
          }
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

      <!-- Expandable Probe Section -->
      @if (finding.probe) {
        <div class="probe-section">
          <button
            type="button"
            class="probe-toggle-btn font-mono"
            [attr.aria-expanded]="probeExpanded()"
            [attr.aria-controls]="'probe-details-' + finding.id"
            (click)="toggleProbe()"
          >
            <span class="toggle-icon" aria-hidden="true">{{ probeExpanded() ? '▼' : '▶' }}</span>
            <span class="toggle-text">Probe</span>
          </button>

          @if (probeExpanded()) {
            <div
              [id]="'probe-details-' + finding.id"
              class="probe-details"
            >
              <div class="probe-summary-row">
                <span class="detail-label font-mono">SUMMARY:</span>
                <p class="probe-summary-text">{{ finding.probe.summary }}</p>
              </div>

              <div class="probe-block">
                <span class="detail-label font-mono" [id]="'probe-script-label-' + finding.id">Probe script</span>
                <pre
                  class="probe-code-block font-mono"
                  tabindex="0"
                  aria-label="Probe script"
                  [attr.aria-labelledby]="'probe-script-label-' + finding.id"
                >{{ finding.probe.script }}</pre>
              </div>

              <div class="probe-block">
                <span class="detail-label font-mono" [id]="'probe-output-label-' + finding.id">Probe output</span>
                <pre
                  class="probe-code-block font-mono"
                  tabindex="0"
                  aria-label="Probe output"
                  [attr.aria-labelledby]="'probe-output-label-' + finding.id"
                >{{ finding.probe.output }}</pre>
              </div>
            </div>
          }
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
      flex-wrap: wrap;
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

    .badge-reproduced {
      @include mono-badge;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      background: $accent-verifier-bg;
      color: $accent-verifier;
      border: 1px solid rgba(163, 113, 247, 0.4);
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

    /* Expandable Probe Section */
    .probe-section {
      border: 1px solid rgba(163, 113, 247, 0.3);
      border-radius: 6px;
      background: rgba(163, 113, 247, 0.04);
      overflow: hidden;
      margin-top: 4px;
    }

    .probe-toggle-btn {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(163, 113, 247, 0.08);
      border: none;
      color: $accent-verifier;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: background-color 0.15s ease;

      &:hover {
        background: rgba(163, 113, 247, 0.15);
      }

      &:focus-visible {
        outline: 2px solid $accent-primary;
        outline-offset: -2px;
      }
    }

    .toggle-icon {
      font-size: 9px;
      transition: transform 0.15s ease;
    }

    .probe-details {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      border-top: 1px solid rgba(163, 113, 247, 0.2);
    }

    .probe-summary-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .probe-summary-text {
      font-size: 12px;
      color: $text-primary;
      margin: 0;
      line-height: 1.4;
    }

    .probe-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .probe-code-block {
      background: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 4px;
      padding: 10px 12px;
      font-family: $font-mono;
      font-size: 11px;
      line-height: 1.5;
      color: $text-primary;
      margin: 0;
      overflow-x: auto;
      max-width: 100%;
      box-sizing: border-box;
      white-space: pre;

      &:focus-visible {
        outline: 1px solid $accent-primary;
      }
    }

    .font-mono { font-family: $font-mono; }
  `],
})
export class FindingCardComponent {
  @Input({ required: true }) finding!: ReviewFinding;

  readonly probeExpanded = signal(false);

  toggleProbe(): void {
    this.probeExpanded.update((v) => !v);
  }
}
