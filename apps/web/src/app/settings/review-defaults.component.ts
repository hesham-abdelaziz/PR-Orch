import { Component, EventEmitter, Input, Output, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModelSelection, Settings } from '@pr-orchestrator/contracts';
import { SelectableModel } from '../providers/providers.store';
import { ProviderQuotasStore } from '../providers/provider-quotas.store';

@Component({
  selector: 'app-review-defaults',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-card">
      <div class="card-header">
        <h2>Review Execution Defaults & Limits</h2>
        <p class="section-desc">
          Configure default concurrency, timeout bounds, diff thresholds, and default model assignments for new reviews.
        </p>
      </div>

      @if (formSettings) {
        <form (ngSubmit)="onSave()" #form="ngForm">
          <!-- Concurrency and Timeouts -->
          <div class="form-section">
            <h3 class="subsection-title">Execution Concurrency & Timeouts</h3>
            <div class="form-grid">
              <div class="form-group">
                <label for="maxParallelReviewers">Max Parallel Reviewers (1-3)</label>
                <input
                  id="maxParallelReviewers"
                  name="maxParallelReviewers"
                  type="number"
                  min="1"
                  max="3"
                  [(ngModel)]="formSettings.maxParallelReviewers"
                  required
                />
                <span class="field-hint">Maximum concurrent CLI subprocesses</span>
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
                  @for (m of availableModels; track m.provider + ':' + m.model) {
                    <option [value]="m.provider + ':' + m.model">
                      {{ m.label }} ({{ m.provider }}){{ getQuotaSnippet(m.provider) }}
                    </option>
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

  onMainModelChange(key: string | null): void {
    if (!this.formSettings) return;
    if (!key) {
      this.formSettings.defaultMain = null;
      return;
    }
    const [provider, model] = key.split(':');
    this.formSettings.defaultMain = {
      provider: provider as ModelSelection['provider'],
      model,
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
