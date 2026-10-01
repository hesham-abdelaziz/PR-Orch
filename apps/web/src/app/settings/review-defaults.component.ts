import { Component, EventEmitter, Input, Output, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ModelSelection,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_ORDER,
  ProviderId,
  ReasoningEffort,
  Settings,
  isReasoningEffortSupported,
} from '@pr-orchestrator/contracts';
import { SelectableModel } from '../providers/providers.store';
import { ProviderQuotasStore } from '../providers/provider-quotas.store';

export interface GroupedSelectableModel {
  provider: ProviderId;
  groupLabel: string;
  models: SelectableModel[];
}

@Component({
  selector: 'app-review-defaults',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-card">
      <div class="card-header">
        <h2>Review Execution Defaults</h2>
        <p class="section-desc">
          Configure baseline reviewer concurrency, execution timeouts, limits, and pre-selected models.
        </p>
      </div>

      @if (formSettings) {
        <form (ngSubmit)="onSave()" class="settings-form">
          <!-- Engine & Parallel Execution -->
          <div class="form-section">
            <h3 class="subsection-title">Concurrency & Timeouts</h3>
            <div class="form-grid">
              <div class="form-group">
                <label for="maxParallelReviewers">Max Parallel Reviewers</label>
                <input
                  id="maxParallelReviewers"
                  name="maxParallelReviewers"
                  type="number"
                  min="1"
                  max="3"
                  [(ngModel)]="formSettings.maxParallelReviewers"
                  required
                />
                <span class="field-hint">Range: 1 to 3 concurrent processes</span>
              </div>

              <div class="form-group">
                <label for="reviewerTimeoutSec">Reviewer Timeout (seconds)</label>
                <input
                  id="reviewerTimeoutSec"
                  name="reviewerTimeoutSec"
                  type="number"
                  min="30"
                  max="3600"
                  [ngModel]="formSettings.reviewerTimeoutMs / 1000"
                  (ngModelChange)="formSettings.reviewerTimeoutMs = $event * 1000"
                  required
                />
                <span class="field-hint">30s to 3,600s</span>
              </div>

              <div class="form-group">
                <label for="verifierTimeoutSec">Main Verifier Timeout (seconds)</label>
                <input
                  id="verifierTimeoutSec"
                  name="verifierTimeoutSec"
                  type="number"
                  min="30"
                  max="3600"
                  [ngModel]="formSettings.verifierTimeoutMs / 1000"
                  (ngModelChange)="formSettings.verifierTimeoutMs = $event * 1000"
                  required
                />
                <span class="field-hint">30s to 3,600s</span>
              </div>
            </div>
          </div>

          <!-- Default Model Assignments -->
          <div class="form-section">
            <h3 class="subsection-title">Default Model Assignments</h3>
            <div class="form-grid">
              <div class="form-group">
                <label for="defaultMain">Default Main Verifier Model</label>
                <select
                  id="defaultMain"
                  name="defaultMain"
                  [ngModel]="selectedMainKey()"
                  (ngModelChange)="onMainModelChange($event)"
                >
                  <option [ngValue]="null">-- None (select manually) --</option>
                  @for (group of groupedModels; track group.provider) {
                    <optgroup [label]="group.groupLabel">
                      @for (m of group.models; track m.provider + ':' + m.model) {
                        <option [value]="m.provider + ':' + m.model">
                          {{ m.label }} ({{ m.provider | uppercase }}){{ getQuotaSnippet(m.provider) }}
                        </option>
                      }
                    </optgroup>
                  }
                </select>
                <span class="field-hint">Exact-one model responsible for evidence verification</span>
                @if (formSettings.defaultMain && getQuotaSummary(formSettings.defaultMain.provider)) {
                  <span class="field-hint selected-quota font-mono">
                    {{ getQuotaSummary(formSettings.defaultMain.provider) }}
                  </span>
                }
              </div>

              <div class="form-group">
                <label for="defaultMainEffort">Default Verifier Reasoning Effort</label>
                <select
                  id="defaultMainEffort"
                  name="defaultMainEffort"
                  [ngModel]="selectedMainEffort()"
                  (ngModelChange)="onMainEffortChange($event)"
                  [disabled]="isEffortDisabled()"
                  aria-label="Default Verifier Reasoning Effort"
                >
                  <option value="default">Default</option>
                  @for (lvl of supportedEffortLevels(); track lvl) {
                    <option [value]="lvl">{{ formatEffortLabel(lvl) }}</option>
                  }
                </select>
                @if (effortExplanation()) {
                  <span class="field-hint">{{ effortExplanation() }}</span>
                } @else {
                  <span class="field-hint">Native reasoning behavior for default verifier</span>
                }
              </div>

              <div class="form-group">
                <label for="workspaceRoot">Workspace Root Directory</label>
                <input
                  id="workspaceRoot"
                  name="workspaceRoot"
                  type="text"
                  [(ngModel)]="formSettings.workspaceRoot"
                  required
                />
                <span class="field-hint">Temporary directory on Windows host for checkouts</span>
              </div>
            </div>
          </div>

          <!-- PR Limits -->
          <div class="form-section">
            <h3 class="subsection-title">Safety Thresholds & Limits</h3>
            <div class="form-grid">
              <div class="form-group">
                <label for="warningChangedFiles">Warning Changed Files</label>
                <input
                  id="warningChangedFiles"
                  name="warningChangedFiles"
                  type="number"
                  min="1"
                  [(ngModel)]="formSettings.limits.warningChangedFiles"
                  required
                />
              </div>

              <div class="form-group">
                <label for="hardChangedFiles">Hard Limit Changed Files</label>
                <input
                  id="hardChangedFiles"
                  name="hardChangedFiles"
                  type="number"
                  min="1"
                  [(ngModel)]="formSettings.limits.hardChangedFiles"
                  required
                />
              </div>

              <div class="form-group">
                <label for="warningDiffBytes">Warning Diff Size (Bytes)</label>
                <input
                  id="warningDiffBytes"
                  name="warningDiffBytes"
                  type="number"
                  min="1024"
                  [(ngModel)]="formSettings.limits.warningDiffBytes"
                  required
                />
              </div>

              <div class="form-group">
                <label for="hardDiffBytes">Hard Limit Diff Size (Bytes)</label>
                <input
                  id="hardDiffBytes"
                  name="hardDiffBytes"
                  type="number"
                  min="1024"
                  [(ngModel)]="formSettings.limits.hardDiffBytes"
                  required
                />
              </div>
            </div>
          </div>

          <!-- Additional Instructions -->
          <div class="form-section">
            <h3 class="subsection-title">Default Additional Instructions</h3>
            <div class="form-group">
              <textarea
                id="defaultInstructions"
                name="defaultInstructions"
                rows="3"
                [(ngModel)]="formSettings.defaultAdditionalInstructions"
                placeholder="Optional instructions added to every review run"
              ></textarea>
              <span class="field-hint">Supplemental instructions for reviewer and verifier prompts</span>
            </div>
          </div>

          <div class="form-actions">
            <button
              type="submit"
              class="btn-primary"
              [disabled]="saving"
            >
              {{ saving ? 'Saving Defaults...' : 'Save Review Defaults' }}
            </button>
          </div>
        </form>
      }
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .settings-card {
      @include card-surface;
      padding: 24px;
    }

    .card-header {
      margin-bottom: 24px;

      h2 {
        font-size: 15px;
        font-weight: 600;
        color: $text-primary;
        margin-bottom: 4px;
      }

      .section-desc {
        font-size: 12px;
        color: $text-secondary;
      }
    }

    .form-section {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid $border-subtle;
    }

    .subsection-title {
      font-size: 13px;
      font-weight: 600;
      color: $text-primary;
      margin-bottom: 14px;
      letter-spacing: -0.01em;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;

      label {
        font-size: 12px;
        font-weight: 500;
        color: $text-primary;
      }

      .field-hint {
        font-size: 11px;
        color: $text-muted;
      }
    }

    textarea {
      width: 100%;
      resize: vertical;
    }

    .selected-quota {
      color: $text-secondary;
      margin-top: 4px;
      display: block;
    }

    .font-mono {
      font-family: $font-mono;
    }

    .form-actions {
      margin-top: 20px;
    }
  `],
})
export class ReviewDefaultsComponent implements OnInit {
  private readonly providerQuotasStore = inject(ProviderQuotasStore, { optional: true });

  @Input() settings: Settings | null = null;
  @Input() availableModels: SelectableModel[] = [];
  @Input() saving = false;
  @Output() save = new EventEmitter<Settings>();

  formSettings: Settings | null = null;

  get groupedModels(): GroupedSelectableModel[] {
    return PROVIDER_ORDER.map((provider) => ({
      provider,
      groupLabel: PROVIDER_DISPLAY_NAMES[provider],
      models: this.availableModels.filter((m) => m.provider === provider),
    })).filter((group) => group.models.length > 0);
  }

  ngOnInit(): void {
    if (this.settings) {
      this.formSettings = JSON.parse(JSON.stringify(this.settings));
    }
  }

  selectedMainKey(): string | null {
    if (!this.formSettings?.defaultMain) {
      return null;
    }
    return `${this.formSettings.defaultMain.provider}:${this.formSettings.defaultMain.model}`;
  }

  selectedMainEffort(): ReasoningEffort {
    return this.formSettings?.defaultMain?.reasoningEffort ?? 'default';
  }

  getSelectedModel(): SelectableModel | undefined {
    if (!this.formSettings?.defaultMain) return undefined;
    return this.availableModels.find(
      (m) =>
        m.provider === this.formSettings?.defaultMain?.provider &&
        m.model === this.formSettings?.defaultMain?.model,
    );
  }

  supportedEffortLevels(): ReasoningEffort[] {
    const model = this.getSelectedModel();
    return (model?.supportedReasoningEfforts ?? []).filter((l) => l !== 'default');
  }

  isEffortDisabled(): boolean {
    return !this.formSettings?.defaultMain || this.supportedEffortLevels().length === 0;
  }

  effortExplanation(): string | null {
    if (!this.formSettings?.defaultMain) return null;
    if (this.supportedEffortLevels().length === 0) {
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

  onMainModelChange(key: string | null): void {
    if (!this.formSettings) return;
    if (!key) {
      this.formSettings.defaultMain = null;
      return;
    }
    const [provider, model] = key.split(':');
    const newOption = this.availableModels.find(
      (m) => m.provider === provider && m.model === model,
    );
    const prevEffort = this.selectedMainEffort();
    let nextEffort: ReasoningEffort = 'default';

    if (prevEffort !== 'default' && isReasoningEffortSupported(newOption, prevEffort)) {
      nextEffort = prevEffort;
    }

    this.formSettings.defaultMain = {
      provider: provider as ModelSelection['provider'],
      model,
      reasoningEffort: nextEffort,
    };
  }

  onMainEffortChange(effort: string): void {
    if (!this.formSettings?.defaultMain) return;
    this.formSettings.defaultMain = {
      ...this.formSettings.defaultMain,
      reasoningEffort: (effort as ReasoningEffort) || 'default',
    };
  }

  onSave(): void {
    if (this.formSettings) {
      this.save.emit(this.formSettings);
    }
  }

  getQuotaSummary(provider: ModelSelection['provider']): string {
    return this.providerQuotasStore?.getProviderSummary(provider) || '';
  }

  getQuotaSnippet(provider: ModelSelection['provider']): string {
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
