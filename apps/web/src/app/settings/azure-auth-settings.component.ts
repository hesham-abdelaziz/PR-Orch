import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AzureAuthStatus } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-azure-auth-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-card">
      <div class="card-header">
        <h2>Azure DevOps Authentication</h2>
        <p class="section-desc">
          Authentication follows strict precedence: a configured PAT is always used first. If not present, the system falls back to an existing authenticated Azure CLI (<code>az</code>) session.
        </p>
      </div>

      <!-- Current Status -->
      <div class="status-summary">
        <div class="status-indicator-box">
          <span class="status-title">Active Authentication Method:</span>
          @if (status?.method === 'pat' && status?.configured) {
            <span class="badge badge-success">Personal Access Token (PAT) — Configured</span>
          } @else if (status?.method === 'azure_cli' && status?.configured) {
            <span class="badge badge-warning">Azure CLI (az) — Active Fallback</span>
          } @else {
            <span class="badge badge-error">Unavailable — Credentials Required</span>
          }
        </div>

        @if (status?.method === 'azure_cli') {
          <div class="cli-info font-mono">
            CLI Path: {{ status.executablePath }}
          </div>
        }
      </div>

      <!-- Test Connection Result Banner -->
      @if (testResult) {
        <div class="azure-test-result" [class.success]="testResult.ok" [class.error]="!testResult.ok" role="alert">
          <span>{{ testResult.ok ? '✓' : '⚠' }}</span>
          <span>{{ testResult.message }}</span>
        </div>
      }

      <!-- PAT Section -->
      <div class="pat-form-box">
        <h3>Personal Access Token (PAT)</h3>
        <p class="pat-desc">
          PAT is stored in Windows Credential Manager. Plaintext values are never saved in SQLite or configuration files.
        </p>

        <div class="form-group">
          <label for="azure-pat">
            {{ isPatConfigured ? 'Replace PAT' : 'Configure PAT' }}
          </label>
          <div class="input-action-row">
            <input
              id="azure-pat"
              name="pat"
              type="password"
              [(ngModel)]="patInput"
              placeholder="Paste Azure DevOps PAT"
              [disabled]="savingPat()"
            />
            <button
              type="button"
              class="btn-primary"
              [disabled]="!patInput.trim() || savingPat()"
              (click)="onSavePat()"
            >
              {{ savingPat() ? 'Saving...' : 'Save PAT' }}
            </button>
            @if (isPatConfigured) {
              <button
                type="button"
                class="btn-danger"
                [disabled]="savingPat()"
                (click)="onDeletePat()"
              >
                Clear PAT
              </button>
            }
          </div>
          <span class="field-hint">Requires Read permissions for Code (pull requests & repositories).</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="card-footer-actions">
        <button
          type="button"
          id="test-azure-btn"
          class="btn-secondary"
          [disabled]="testingConnection()"
          (click)="onTestConnection()"
        >
          {{ testingConnection() ? 'Testing Connection...' : 'Test Azure Connection' }}
        </button>
      </div>
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
      margin-bottom: 20px;

      h2 {
        font-size: 15px;
        font-weight: 600;
        color: $text-primary;
        margin-bottom: 4px;
      }

      .section-desc {
        font-size: 12px;
        color: $text-secondary;

        code {
          color: $accent-primary;
          background: $bg-surface-3;
          padding: 1px 4px;
          border-radius: 3px;
        }
      }
    }

    .status-summary {
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 20px;
    }

    .status-indicator-box {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .status-title {
      font-size: 12px;
      font-weight: 500;
      color: $text-secondary;
    }

    .cli-info {
      font-size: 11px;
      color: $text-muted;
      margin-top: 8px;
    }

    .font-mono {
      font-family: $font-mono;
    }

    .badge {
      @include mono-badge;
    }

    .badge-success {
      background-color: rgba(63, 185, 80, 0.15);
      color: $status-clean;
      border: 1px solid rgba(63, 185, 80, 0.3);
    }

    .badge-warning {
      background-color: rgba(245, 158, 11, 0.15);
      color: $severity-medium;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge-error {
      background-color: rgba(248, 81, 73, 0.15);
      color: $severity-critical;
      border: 1px solid rgba(248, 81, 73, 0.3);
    }

    .azure-test-result {
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;

      &.success {
        background-color: rgba(63, 185, 80, 0.15);
        border: 1px solid rgba(63, 185, 80, 0.4);
        color: #9df2a6;
      }

      &.error {
        background-color: rgba(248, 81, 73, 0.15);
        border: 1px solid rgba(248, 81, 73, 0.4);
        color: #ffb4ab;
      }
    }

    .pat-form-box {
      margin-top: 20px;

      h3 {
        font-size: 13px;
        font-weight: 600;
        color: $text-primary;
        margin-bottom: 4px;
      }

      .pat-desc {
        font-size: 12px;
        color: $text-secondary;
        margin-bottom: 12px;
      }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-width: 520px;

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

    .input-action-row {
      display: flex;
      gap: 8px;

      input {
        flex: 1;
      }
    }

    .card-footer-actions {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid $border-subtle;
    }
  `],
})
export class AzureAuthSettingsComponent {
  @Input() status: AzureAuthStatus | null = null;
  @Input() testResult: { ok: boolean; message: string } | null = null;
  @Output() savePat = new EventEmitter<string>();
  @Output() deletePat = new EventEmitter<void>();
  @Output() testConnection = new EventEmitter<void>();

  patInput = '';
  savingPat = signal(false);
  testingConnection = signal(false);

  get isPatConfigured(): boolean {
    return this.status?.method === 'pat' && this.status.configured;
  }

  onSavePat(): void {
    if (this.patInput.trim()) {
      this.savePat.emit(this.patInput.trim());
      this.patInput = '';
    }
  }

  onDeletePat(): void {
    this.deletePat.emit();
    this.patInput = '';
  }

  onTestConnection(): void {
    this.testConnection.emit();
  }
}
