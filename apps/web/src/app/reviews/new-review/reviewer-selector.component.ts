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
  selector: 'app-reviewer-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="selector-card">
      <div class="selector-header">
        <div class="header-left">
          <span class="step-num">03</span>
          <div>
            <div class="title-row">
              <h2>Parallel Reviewer Models</h2>
              <span class="badge badge-active font-mono">{{ reviewers.length }} / 8 SELECTED</span>
            </div>
            <p class="section-desc">
              Independent models analyze the diff concurrently. Each produces structured claims, severity grades, and code citations.
            </p>
          </div>
        </div>
      </div>

      <!-- Reviewer cards list -->
      <div class="reviewers-list">
        @for (reviewer of reviewers; track reviewer.provider + ':' + reviewer.model; let idx = $index) {
          <div class="reviewer-item">
            <div class="reviewer-meta">
              <span class="provider-glyph" [class]="reviewer.provider">●</span>
              <div class="reviewer-info">
                <div class="name-row">
                  <span class="model-id font-mono">{{ reviewer.model }}</span>
                  <span class="provider-badge font-mono">{{ reviewer.provider | uppercase }}</span>
                  @if (reviewer.reasoningEffort && reviewer.reasoningEffort !== 'default') {
                    <span class="effort-badge font-mono">{{ reviewer.reasoningEffort | uppercase }} EFFORT</span>
                  }
                </div>
                <span class="model-label truncate" [title]="getModelLabel(reviewer)">
                  {{ getModelLabel(reviewer) }}
                </span>
                @if (getQuotaSummary(reviewer.provider)) {
                  <span class="reviewer-quota font-mono truncate" [title]="getQuotaSummary(reviewer.provider)">
                    {{ getQuotaSummary(reviewer.provider) }}
                  </span>
                }
              </div>
            </div>

            <!-- Individual effort selector for this reviewer -->
            <div class="reviewer-effort-col">
              <label [for]="'reviewer-effort-' + idx" class="sr-only">
                Reasoning effort for {{ reviewer.model }}
              </label>
              <select
                [id]="'reviewer-effort-' + idx"
                class="reviewer-effort-select"
                [ngModel]="reviewer.reasoningEffort ?? 'default'"
                (ngModelChange)="onEffortChange(idx, $event)"
                [disabled]="isReviewerEffortDisabled(reviewer)"
                [title]="getReviewerEffortTitle(reviewer)"
                [attr.aria-label]="'Reasoning effort for ' + reviewer.model"
              >
                <option value="default">Default</option>
                @for (lvl of getSupportedEfforts(reviewer); track lvl) {
                  <option [value]="lvl">{{ formatEffortLabel(lvl) }}</option>
                }
              </select>
            </div>

            <div class="reviewer-actions">
              <button
                type="button"
                class="remove-btn"
                [disabled]="reviewers.length <= 1"
                [title]="reviewers.length <= 1 ? 'Minimum 1 reviewer required' : 'Remove reviewer'"
                (click)="onRemove(idx)"
              >
                ✕
              </button>
            </div>
          </div>
        }
      </div>

      <!-- Add Reviewer Control -->
      @if (reviewers.length < 8) {
        <div class="add-reviewer-row">
          <div class="select-wrapper">
            <select
              id="add-reviewer-select"
              [ngModel]="newReviewerKey"
              (ngModelChange)="onSelectNewReviewer($event)"
              aria-label="Add Reviewer Model"
            >
              <option value="" disabled selected>— Add Reviewer Model —</option>
              @for (group of groupedModels; track group.provider) {
                <optgroup [label]="group.groupLabel">
                  @for (opt of group.models; track opt.provider + ':' + opt.model) {
                    <option
                      [value]="opt.provider + ':' + opt.model"
                      [disabled]="isModelDisabled(opt)"
                    >
                      {{ opt.label }} ({{ opt.provider | uppercase }}){{ getQuotaSnippet(opt.provider) }}
                      @if (isModelSelected(opt)) {
                        — [Already Added]
                      } @else if (opt.available === false) {
                        — [Unavailable: {{ opt.unavailableReason || 'CLI unauthenticated' }}]
                      }
                    </option>
                  }
                </optgroup>
              }
            </select>
          </div>

          <button
            type="button"
            class="btn-secondary add-btn"
            [disabled]="!newReviewerKey"
            (click)="onAdd()"
          >
            + Add Reviewer
          </button>
        </div>
      } @else {
        <div class="max-limit-hint font-mono">
          Maximum of 8 parallel reviewer models reached.
        </div>
      }
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

    .badge-active {
      background-color: rgba(56, 189, 248, 0.15);
      color: $accent-primary;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .effort-badge {
      @include mono-badge;
      background-color: rgba(163, 113, 247, 0.15);
      color: $accent-verifier;
      border: 1px solid rgba(163, 113, 247, 0.3);
      font-size: 9px;
    }

    .reviewers-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }

    .reviewer-item {
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      transition: background-color 0.15s ease;

      &:hover {
        background-color: $bg-surface-2;
      }
    }

    .reviewer-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }

    .provider-glyph {
      font-size: 10px;

      &.claude { color: $provider-claude; }
      &.codex { color: $provider-codex; }
      &.gemini { color: $provider-gemini; }
    }

    .reviewer-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }

    .name-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .model-id {
      font-size: 13px;
      font-weight: 600;
      color: $text-primary;
    }

    .provider-badge {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $text-secondary;
      font-size: 10px;
    }

    .model-label {
      font-size: 11px;
      color: $text-secondary;
      @include truncate;
    }

    .reviewer-effort-col {
      width: 140px;
      flex-shrink: 0;

      .reviewer-effort-select {
        width: 100%;
        padding: 4px 8px;
        font-size: 12px;
      }
    }

    .reviewer-actions {
      display: flex;
      align-items: center;
    }

    .remove-btn {
      width: 28px;
      height: 28px;
      border-radius: 4px;
      background: transparent;
      border: 1px solid transparent;
      color: $text-muted;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.15s ease;

      &:hover:not(:disabled) {
        background-color: rgba(248, 81, 73, 0.15);
        color: $severity-critical;
        border-color: rgba(248, 81, 73, 0.3);
      }

      &:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
    }

    .add-reviewer-row {
      display: flex;
      gap: 8px;
      align-items: center;

      .select-wrapper {
        flex: 1;
        max-width: 440px;

        select {
          width: 100%;
        }
      }

      .add-btn {
        white-space: nowrap;
      }
    }

    .max-limit-hint {
      font-size: 11px;
      color: $text-muted;
    }

    .truncate {
      @include truncate;
    }

    .reviewer-quota {
      font-size: 10px;
      color: $text-secondary;
      margin-top: 2px;
    }

    .font-mono {
      font-family: $font-mono;
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
export class ReviewerSelectorComponent {
  private readonly providerQuotasStore = inject(ProviderQuotasStore, { optional: true });

  @Input() reviewers: ModelSelection[] = [];
  @Input() availableModels: SelectableModelOption[] = [];

  @Output() add = new EventEmitter<ModelSelection>();
  @Output() remove = new EventEmitter<number>();
  @Output() update = new EventEmitter<{ index: number; selection: ModelSelection }>();

  newReviewerKey = '';

  get groupedModels(): ModelGroupOption[] {
    return PROVIDER_ORDER.map((provider) => ({
      provider,
      groupLabel: PROVIDER_DISPLAY_NAMES[provider],
      models: this.availableModels.filter((m) => m.provider === provider),
    })).filter((group) => group.models.length > 0);
  }

  getModelLabel(reviewer: ModelSelection): string {
    const found = this.availableModels.find(
      (m) => m.provider === reviewer.provider && m.model === reviewer.model,
    );
    return found?.label || reviewer.model;
  }

  isModelSelected(opt: SelectableModelOption): boolean {
    return this.reviewers.some(
      (r) => r.provider === opt.provider && r.model === opt.model,
    );
  }

  isModelDisabled(opt: SelectableModelOption): boolean {
    return opt.available === false || this.isModelSelected(opt);
  }

  getSupportedEfforts(reviewer: ModelSelection): ReasoningEffort[] {
    const found = this.availableModels.find(
      (m) => m.provider === reviewer.provider && m.model === reviewer.model,
    );
    return (found?.supportedReasoningEfforts ?? []).filter((l) => l !== 'default');
  }

  isReviewerEffortDisabled(reviewer: ModelSelection): boolean {
    return this.getSupportedEfforts(reviewer).length === 0;
  }

  getReviewerEffortTitle(reviewer: ModelSelection): string {
    if (this.isReviewerEffortDisabled(reviewer)) {
      return 'Effort override not supported for this model (Default only)';
    }
    return 'Select reasoning effort for this model';
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

  onSelectNewReviewer(key: string): void {
    this.newReviewerKey = key;
  }

  onEffortChange(index: number, effort: string): void {
    const current = this.reviewers[index];
    if (!current) return;
    const updated: ModelSelection = {
      ...current,
      reasoningEffort: (effort as ReasoningEffort) || 'default',
    };
    this.update.emit({ index, selection: updated });
  }

  onAdd(): void {
    if (!this.newReviewerKey) return;
    const [provider, ...rest] = this.newReviewerKey.split(':');
    const model = rest.join(':');
    if (provider && model) {
      this.add.emit({
        provider: provider as ProviderId,
        model,
        reasoningEffort: 'default',
      });
      this.newReviewerKey = '';
    }
  }

  onRemove(index: number): void {
    if (this.reviewers.length > 1) {
      this.remove.emit(index);
    }
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
