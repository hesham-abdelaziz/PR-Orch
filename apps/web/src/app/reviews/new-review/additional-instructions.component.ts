import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-additional-instructions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="instructions-card">
      <div class="instructions-header">
        <div class="header-left">
          <span class="step-num">04</span>
          <div>
            <div class="title-row">
              <h2>Review Focus Directives (Optional)</h2>
              <span class="badge font-mono">OPTIONAL</span>
            </div>
            <p class="section-desc">
              Inject ephemeral context for this single PR run (e.g., focus areas, migration context, architectural boundaries).
            </p>
          </div>
        </div>
      </div>

      <div class="textarea-wrapper">
        <textarea
          id="additional-instructions"
          [ngModel]="instructions"
          (ngModelChange)="onInstructionsChange($event)"
          maxlength="10000"
          rows="4"
          placeholder="e.g., Pay special attention to thread-safety in the connection pool and backward compatibility of the public API endpoints."
          aria-label="Additional review instructions"
        ></textarea>
        <div class="textarea-footer">
          <span class="supplement-hint">
            Directives supplement, but never override, protected core quality standards.
          </span>
          <span class="char-count font-mono" [class.near-limit]="instructions.length > 9000">
            {{ instructions.length }} / 10,000
          </span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .instructions-card {
      @include card-surface;
      padding: 20px;
    }

    .instructions-header {
      margin-bottom: 16px;
    }

    .header-left {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      background-color: $bg-surface-3;
      color: $text-secondary;
      font-family: $font-mono;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;

      h2 {
        font-size: 14px;
        font-weight: 600;
        color: $text-primary;
      }
    }

    .section-desc {
      font-size: 12px;
      color: $text-secondary;
    }

    .badge {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $text-muted;
    }

    .textarea-wrapper {
      display: flex;
      flex-direction: column;
      gap: 8px;

      textarea {
        width: 100%;
        font-family: $font-sans;
        font-size: 12px;
        line-height: 1.5;
        resize: vertical;
        min-height: 80px;
      }
    }

    .textarea-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
    }

    .supplement-hint {
      color: $text-muted;
    }

    .char-count {
      color: $text-muted;

      &.near-limit {
        color: $severity-medium;
      }
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class AdditionalInstructionsComponent {
  @Input() instructions = '';
  @Output() instructionsChange = new EventEmitter<string>();

  onInstructionsChange(val: string): void {
    this.instructionsChange.emit(val);
  }
}
