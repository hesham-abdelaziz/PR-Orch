import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { VerifierDecision } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-rejected-claims-audit',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (decisions.length > 0) {
      <details class="rejected-claims-audit" id="rejected-audit">
        <summary class="audit-summary font-mono">
          <div class="summary-left">
            <span class="disclosure-arrow">▶</span>
            <span class="summary-title">Rejected Claims Audit ({{ decisions.length }} claims rejected by verifier)</span>
          </div>
          <span class="badge-rejected">VERIFIER AUDIT</span>
        </summary>

        <div class="audit-content">
          <p class="audit-desc">
            The following claims raised by individual reviewer models were evaluated against the repository code and rejected as false positives or invalid:
          </p>

          <div class="decisions-list">
            @for (decision of decisions; track $index) {
              <div class="decision-card">
                <div class="decision-header">
                  <span class="badge-verdict font-mono">{{ decision.verdict | uppercase }}</span>
                  <span class="candidate-ids font-mono">
                    Candidates: {{ decision.candidateIds.join(', ') }}
                  </span>
                </div>
                <div class="rationale-body">
                  <span class="rationale-label font-mono">RATIONALE:</span>
                  <p class="rationale-text">{{ decision.rationale }}</p>
                </div>
              </div>
            }
          </div>
        </div>
      </details>
    }
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .rejected-claims-audit {
      @include card-surface;
      margin-top: 16px;
      overflow: hidden;

      &[open] {
        .disclosure-arrow {
          transform: rotate(90deg);
        }
      }
    }

    .audit-summary {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 14px 18px;
      cursor: pointer;
      user-select: none;
      list-style: none;
      background-color: $bg-surface-2;
      border-bottom: 1px solid transparent;

      &::-webkit-details-marker {
        display: none;
      }

      &:hover {
        background-color: $bg-surface-3;
      }

      &:focus-visible {
        outline: 1px solid $accent-primary;
      }
    }

    details[open] .audit-summary {
      border-bottom-color: $border-subtle;
    }

    .summary-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .disclosure-arrow {
      font-size: 10px;
      color: $text-muted;
      transition: transform 0.15s ease;
    }

    .summary-title {
      font-size: 12px;
      font-weight: 600;
      color: $text-secondary;
    }

    .badge-rejected {
      @include mono-badge;
      background-color: rgba(248, 81, 73, 0.1);
      color: $severity-critical;
      border: 1px solid rgba(248, 81, 73, 0.3);
      font-size: 10px;
    }

    .audit-content {
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background-color: $bg-surface-1;
    }

    .audit-desc {
      font-size: 12px;
      color: $text-muted;
      margin: 0;
    }

    .decisions-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .decision-card {
      background-color: $bg-surface-2;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .decision-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .badge-verdict {
      @include mono-badge;
      background-color: rgba(63, 185, 80, 0.1);
      color: $status-clean;
      border: 1px solid rgba(63, 185, 80, 0.3);
      font-size: 9px;
    }

    .candidate-ids {
      font-size: 10px;
      color: $text-muted;
    }

    .rationale-body {
      display: flex;
      gap: 8px;
      font-size: 12px;
      line-height: 1.5;
    }

    .rationale-label {
      color: $text-muted;
      font-size: 10px;
      font-weight: 600;
      flex-shrink: 0;
      padding-top: 2px;
    }

    .rationale-text {
      color: $text-primary;
      margin: 0;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class RejectedClaimsAuditComponent {
  @Input() decisions: VerifierDecision[] = [];
}
