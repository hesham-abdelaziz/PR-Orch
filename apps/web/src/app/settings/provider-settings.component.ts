import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProvidersStore } from '../providers/providers.store';
import { ProviderStatusCardComponent } from '../providers/provider-status-card.component';

@Component({
  selector: 'app-provider-settings',
  standalone: true,
  imports: [CommonModule, ProviderStatusCardComponent],
  template: `
    <div class="provider-settings">
      <div class="settings-card-header">
        <div>
          <h2>Local AI CLI Providers</h2>
          <p class="section-desc">
            The orchestrator resolves Claude, Codex, and Gemini CLI binaries from your system PATH and executes ephemeral local subprocesses.
          </p>
        </div>

        <button
          type="button"
          class="btn-secondary refresh-btn"
          [disabled]="providersStore.loading()"
          (click)="onRefresh()"
        >
          <span class="refresh-icon" [class.spinning]="providersStore.loading()">⟳</span>
          <span>{{ providersStore.loading() ? 'Detecting Binaries...' : 'Detect CLI Binaries' }}</span>
        </button>
      </div>

      @if (providersStore.error()) {
        <div class="error-banner" role="alert">
          <span>⚠</span>
          <span>{{ providersStore.error() }}</span>
        </div>
      }

      <div class="provider-cards-grid">
        @for (status of providersStore.providers(); track status.provider) {
          <app-provider-status-card [status]="status" />
        } @empty {
          <div class="empty-state">
            @if (providersStore.loading()) {
              <span>Scanning PATH for AI CLIs...</span>
            } @else {
              <span>No providers detected. Click "Detect CLI Binaries" to scan.</span>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .provider-settings {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .settings-card-header {
      @include card-surface;
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;

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

    .refresh-btn {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .refresh-icon {
      font-size: 14px;

      &.spinning {
        animation: spin 1s linear infinite;
      }
    }

    @keyframes spin {
      100% { transform: rotate(360deg); }
    }

    .provider-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }

    .empty-state {
      @include card-surface;
      padding: 32px;
      text-align: center;
      color: $text-muted;
      font-size: 13px;
    }
  `],
})
export class ProviderSettingsComponent {
  readonly providersStore = inject(ProvidersStore);

  async onRefresh(): Promise<void> {
    await this.providersStore.refresh();
  }
}
