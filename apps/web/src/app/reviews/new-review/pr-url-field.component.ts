import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-pr-url-field',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="field-card">
      <div class="field-header">
        <div class="header-left">
          <span class="step-num">01</span>
          <div>
            <h2>Target Azure DevOps Pull Request</h2>
            <p class="field-desc">
              Fetched via local Windows Credential Manager PAT or Azure CLI (az) fallback. Read-only static inspection.
            </p>
          </div>
        </div>

        @if (validated) {
          <span class="badge badge-success">
            <span>✓</span>
            <span>Metadata Validated</span>
          </span>
        }
      </div>

      <div class="input-row">
        <div class="input-wrapper">
          <span class="url-glyph font-mono">PR</span>
          <input
            id="pr-url-input"
            type="url"
            [ngModel]="url"
            (ngModelChange)="onUrlChange($event)"
            (keydown.enter)="onValidate()"
            placeholder="https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}"
            [disabled]="validating"
            aria-label="Azure DevOps Pull Request URL"
            autocomplete="off"
            spellcheck="false"
          />
        </div>

        <div class="actions-row">
          <button
            type="button"
            class="btn-primary validate-btn"
            [disabled]="!url?.trim() || validating"
            (click)="onValidate()"
          >
            {{ validating ? 'Validating...' : 'Validate PR' }}
          </button>
          <button
            type="button"
            class="btn-secondary clear-btn"
            [disabled]="!url || validating"
            (click)="onClear()"
          >
            Clear
          </button>
        </div>
      </div>

      @if (error) {
        <div class="url-error" role="alert">
          <span>⚠</span>
          <span>{{ error }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .field-card {
      @include card-surface;
      padding: 20px;
    }

    .field-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      gap: 12px;
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
      background-color: rgba(56, 189, 248, 0.15);
      color: $accent-primary;
      font-family: $font-mono;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    h2 {
      font-size: 14px;
      font-weight: 600;
      color: $text-primary;
      margin-bottom: 4px;
    }

    .field-desc {
      font-size: 12px;
      color: $text-secondary;
    }

    .badge {
      @include mono-badge;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }

    .badge-success {
      background-color: rgba(63, 185, 80, 0.15);
      color: $status-clean;
      border: 1px solid rgba(63, 185, 80, 0.3);
    }

    .input-row {
      display: flex;
      flex-direction: column;
      gap: 8px;

      @media (min-width: 640px) {
        flex-direction: row;
        align-items: center;
      }
    }

    .input-wrapper {
      position: relative;
      flex: 1;

      .url-glyph {
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 10px;
        color: $accent-primary;
        background-color: $bg-surface-3;
        padding: 1px 4px;
        border-radius: 3px;
        pointer-events: none;
      }

      input {
        width: 100%;
        padding-left: 36px;
        font-family: $font-mono;
        font-size: 12px;
      }
    }

    .actions-row {
      display: flex;
      gap: 8px;
    }

    .validate-btn {
      white-space: nowrap;
    }

    .clear-btn {
      white-space: nowrap;
    }

    .url-error {
      margin-top: 12px;
      padding: 8px 12px;
      background-color: rgba(248, 81, 73, 0.12);
      border: 1px solid rgba(248, 81, 73, 0.3);
      border-radius: 6px;
      color: #ffb4ab;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class PrUrlFieldComponent {
  @Input() url = '';
  @Input() validating = false;
  @Input() error: string | null = null;
  @Input() validated = false;

  @Output() urlChange = new EventEmitter<string>();
  @Output() validate = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();

  onUrlChange(newVal: string): void {
    this.urlChange.emit(newVal);
  }

  onValidate(): void {
    this.validate.emit();
  }

  onClear(): void {
    this.clear.emit();
  }
}
