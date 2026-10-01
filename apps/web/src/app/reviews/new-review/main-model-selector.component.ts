import { ProviderQuotasStore } from '../../providers/provider-quotas.store';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ModelSelection,
  ProviderId,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_ORDER,
  ReasoningEffort,
  isReasoningEffortSupported,
} from '@pr-orchestrator/contracts';

export interface SelectableModelOption {
  provider: ProviderId;
  model: string;
  label: string;
  available?: boolean;
  unavailableReason?: string;
  supportedReasoningEfforts?: ReasoningEffort[];
}

export interface ModelGroupOption {
  provider: ProviderId;
  groupLabel: string;
  models: SelectableModelOption[];
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
        <div class="controls-row">
          <div class="form-group model-group">
            <label for="main-model-select">Select Primary Verifier</label>
            <div class="select-wrapper">
              <select
                id="main-model-select"
                [ngModel]="selectedKey"
                (ngModelChange)="onSelectModel($event)"
                aria-label="Main Verifier Model"
              >
                @for (group of groupedModels; track group.provider) {
                  <optgroup [label]="group.groupLabel">
                    @for (opt of group.models; track opt.provider + ':' + opt.model) {
                      <option
                        [value]="opt.provider + ':' + opt.model"
                        [disabled]="opt.available === false"
                      >
                        {{ opt.label }} ({{ opt.provider | uppercase }}){{ getQuotaSnippet(opt.provider) }}{{ opt.available === false ? ' — [Unavailable: ' + (opt.unavailableReason || 'CLI unauthenticated') + ']' : '' }}
                      </option>
                    }
                  </optgroup>
                }
              </select>
            </div>
          </div>

          <div class="form-group effort-group">
            <label for="main-effort-select">Reasoning Effort</label>
            <div class="select-wrapper">
              <select
                id="main-effort-select"
                [ngModel]="currentEffort"
                (ngModelChange)="onSelectEffort($event)"
                aria-label="Verifier Reasoning Effort"
                [disabled]="isEffortDisabled"
              >
                <option value="default">Default</option>
                @for (lvl of supportedEffortLevels; track lvl) {
                  <option [value]="lvl">{{ formatEffortLabel(lvl) }}</option>
                }
              </select>
            </div>
            @if (effortExplanation) {
              <span class="effort-hint" id="main-effort-hint">{{ effortExplanation }}</span>
            }
          </div>
        </div>

        <!-- Accessible announcement region for model changes resetting effort -->
        <div class="sr-only" aria-live="polite" aria-atomic="true">
          {{ accessibleAnnouncement }}
        </div>

        @if (selectedModelOption) {
          <div class="active-model-box">
            <div class="model-meta">
              <span class="provider-glyph" [class]="selectedModelOption.provider">●</span>
              <span class="model-name font-mono">{{ selectedModelOption.model }}</span>
              <span class="role-badge font-mono">PRIMARY VERIFIER</span>
              @if (currentEffort && currentEffort !== 'default') {
                <span class="effort-badge font-mono">{{ currentEffort | uppercase }} EFFORT</span>
              }
            </div>
            <div class="model-desc">
              {{ selectedModelOption.label }}
            </div>
            @if (getQuotaSummary(selectedModelOption.provider)) {
              <div class="model-quota-row font-mono">
                <span class="quota-icon">⚡</span>
                <span class="quota-text">{{ getQuotaSummary(selectedModelOption.provider) }}</span>
              </div>
            }
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

    .controls-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: flex-start;
    }

    .model-group {
      flex: 1;
      min-width: 280px;
    }

    .effort-group {
      width: 200px;
      flex-shrink: 0;
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
      }
    }

    .effort-hint {
      font-size: 11px;
      color: $text-muted;
      line-height: 1.3;
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

    .effort-badge {
      @include mono-badge;
      background-color: rgba(163, 113, 247, 0.15);
      color: $accent-verifier;
      border: 1px solid rgba(163, 113, 247, 0.3);
      font-size: 10px;
    }

    .model-desc {
      font-size: 12px;
      color: $text-secondary;
    }

    .font-mono {
      font-family: $font-mono;
    }

    .model-quota-row {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid $border-subtle;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: $text-secondary;

      .quota-icon {
        color: $accent-primary;
        font-size: 11px;
      }

      .quota-text {
        @include truncate;
      }
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
  `],
})
export class MainModelSelectorComponent {
  private readonly providerQuotasStore = inject(ProviderQuotasStore, { optional: true });

  @Input() selection: ModelSelection | null = null;
  @Input() availableModels: SelectableModelOption[] = [];
  @Output() selectionChange = new EventEmitter<ModelSelection>();

  accessibleAnnouncement = '';

  get selectedKey(): string {
    return this.selection ? `${this.selection.provider}:${this.selection.model}` : '';
  }

  get selectedModelOption(): SelectableModelOption | undefined {
    if (!this.selection) return undefined;
    return this.availableModels.find(
      (m) => m.provider === this.selection?.provider && m.model === this.selection?.model,
    );
  }

  get groupedModels(): ModelGroupOption[] {
    return PROVIDER_ORDER.map((provider) => ({
      provider,
      groupLabel: PROVIDER_DISPLAY_NAMES[provider],
      models: this.availableModels.filter((m) => m.provider === provider),
    })).filter((group) => group.models.length > 0);
  }

  get currentEffort(): ReasoningEffort {
    return this.selection?.reasoningEffort ?? 'default';
  }

  get supportedEffortLevels(): ReasoningEffort[] {
    const supported = this.selectedModelOption?.supportedReasoningEfforts ?? [];
    return supported.filter((lvl) => lvl !== 'default');
  }

  get isEffortDisabled(): boolean {
    return !this.selection || this.supportedEffortLevels.length === 0;
  }

  get effortExplanation(): string | null {
    if (!this.selection) return null;
    if (this.supportedEffortLevels.length === 0) {
      return 'Effort override not supported for this model';
    }
    return null;
  }

  formatEffortLabel(lvl: ReasoningEffort): string {
    switch (lvl) {
      case 'low': return 'Low';
      case 'medium': return 'Medium';
      case 'high': return 'High';
      case 'xhigh': return 'Extra High (xhigh)';
      case 'max': return 'Maximum';
      default: return 'Default';
    }
  }

  onSelectModel(key: string): void {
    const [provider, ...rest] = key.split(':');
    const model = rest.join(':');
    if (!provider || !model) return;

    const newOption = this.availableModels.find(
      (m) => m.provider === provider && m.model === model,
    );

    const prevEffort = this.currentEffort;
    let nextEffort: ReasoningEffort = 'default';

    if (prevEffort !== 'default' && isReasoningEffortSupported(newOption, prevEffort)) {
      nextEffort = prevEffort;
      this.accessibleAnnouncement = '';
    } else if (prevEffort !== 'default') {
      nextEffort = 'default';
      this.accessibleAnnouncement = `Reasoning effort reset to Default because ${newOption?.label || model} does not support ${this.formatEffortLabel(prevEffort)} reasoning effort.`;
    } else {
      this.accessibleAnnouncement = '';
    }

    this.selectionChange.emit({
      provider: provider as ProviderId,
      model,
      reasoningEffort: nextEffort,
    });
  }

  onSelectEffort(effort: string): void {
    if (!this.selection) return;
    this.selectionChange.emit({
      ...this.selection,
      reasoningEffort: (effort as ReasoningEffort) || 'default',
    });
  }

  getQuotaSummary(provider: 'claude' | 'codex' | 'gemini'): string {
    return this.providerQuotasStore?.getProviderSummary(provider) || '';
  }

  getQuotaSnippet(provider: 'claude' | 'codex' | 'gemini'): string {
    if (!this.providerQuotasStore) return '';
    const quota = this.providerQuotasStore.getProviderQuota(provider);
    if (!quota) return '';
    if (quota.status === 'available') {
      const isStale = this.providerQuotasStore.isProviderLocallyStale(quota);
      const staleTag = isStale ? ' (stale)' : '';
      const parts = quota.windows.map((w) => {
        const dur = this.providerQuotasStore!.formatDuration(w.windowDurationMins);
        const prefix = dur ? `${dur}: ` : '';
        if (this.providerQuotasStore!.isWindowResetPassed(w)) {
          return `${prefix}Reset pending`;
        }
        return `${prefix}${w.remainingPercent !== null ? w.remainingPercent + '%' : 'Unavailable'}`;
      });
      return parts.length ? ` — [${provider.toUpperCase()} shared quota${staleTag}: ${parts.join('; ')}]` : '';
    }
    if (quota.status === 'unauthenticated') {
      return ` — [${provider.toUpperCase()}: Unauthenticated]`;
    }
    return '';
  }
}
