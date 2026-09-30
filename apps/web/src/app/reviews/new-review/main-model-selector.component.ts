import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModelSelection } from '@pr-orchestrator/contracts';

export interface SelectableModelOption {
  provider: 'claude' | 'codex' | 'gemini';
  model: string;
  label: string;
  available?: boolean;
  unavailableReason?: string;
}

@Component({
  selector: 'app-main-model-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="selector-card">
      <div class="selector-header">
        <div class="header-left">
          <span class="step-num">02</span>
          <div>
            <div class="title-row">
              <h2>Main Verifier Model</h2>
              <span class="badge badge-required font-mono">1 REQUIRED</span>
            </div>
            <p class="section-desc">
              Synthesizes overlapping reviewer claims, calibrates final severity grades, reconciles AST changes, and authors the verified report.
            </p>
          </div>
        </div>
      </div>

      <div class="selector-body">
        <div class="form-group">
          <label for="main-model-select">Select Primary Verifier</label>
          <div class="select-wrapper">
            <select
              id="main-model-select"
              [ngModel]="selectedKey"
              (ngModelChange)="onSelectModel($event)"
              aria-label="Main Verifier Model"
            >
              @for (opt of availableModels; track opt.provider + ':' + opt.model) {
                <option
                  [value]="opt.provider + ':' + opt.model"
                  [disabled]="opt.available === false"
                >
                  {{ opt.label }} ({{ opt.provider | uppercase }}){{ opt.available === false ? ' — [Unavailable: ' + (opt.unavailableReason || 'CLI unauthenticated') + ']' : '' }}
                </option>
              }
            </select>
          </div>
        </div>

        @if (selectedModelOption) {
          <div class="active-model-box">
            <div class="model-meta">
              <span class="provider-glyph" [class]="selectedModelOption.provider">●</span>
              <span class="model-name font-mono">{{ selectedModelOption.model }}</span>
              <span class="role-badge font-mono">PRIMARY VERIFIER</span>
            </div>
            <div class="model-desc">
              {{ selectedModelOption.label }}
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .selector-card {
      @include card-surface;
      padding: 20px;
    }

    .selector-header {
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
      background-color: rgba(163, 113, 247, 0.15);
      color: $accent-verifier;
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
    }

    .badge-required {
      background-color: rgba(163, 113, 247, 0.15);
      color: $accent-verifier;
      border: 1px solid rgba(163, 113, 247, 0.3);
    }

    .selector-body {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;

      label {
        font-size: 11px;
        font-weight: 500;
        color: $text-muted;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
    }

    .select-wrapper {
      select {
        width: 100%;
        max-width: 500px;
      }
    }

    .active-model-box {
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .model-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .provider-glyph {
      font-size: 10px;

      &.claude { color: $provider-claude; }
      &.codex { color: $provider-codex; }
      &.gemini { color: $provider-gemini; }
    }

    .model-name {
      font-size: 13px;
      font-weight: 600;
      color: $text-primary;
    }

    .role-badge {
      @include mono-badge;
      background-color: rgba(56, 189, 248, 0.15);
      color: $accent-primary;
      font-size: 10px;
    }

    .model-desc {
      font-size: 12px;
      color: $text-secondary;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class MainModelSelectorComponent {
  @Input() selection: ModelSelection | null = null;
  @Input() availableModels: SelectableModelOption[] = [];
  @Output() selectionChange = new EventEmitter<ModelSelection>();

  get selectedKey(): string {
    return this.selection ? `${this.selection.provider}:${this.selection.model}` : '';
  }

  get selectedModelOption(): SelectableModelOption | undefined {
    if (!this.selection) return undefined;
    return this.availableModels.find(
      (m) => m.provider === this.selection?.provider && m.model === this.selection?.model,
    );
  }

  onSelectModel(key: string): void {
    const [provider, ...rest] = key.split(':');
    const model = rest.join(':');
    if (provider && model) {
      this.selectionChange.emit({
        provider: provider as 'claude' | 'codex' | 'gemini',
        model,
      });
    }
  }
}
