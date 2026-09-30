import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProviderStatus } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-provider-status-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="provider-card" [class.uninstalled]="!status.installed">
      <div class="card-header">
        <div class="provider-title-row">
          <span class="provider-glyph" [class]="status.provider">●</span>
          <span class="provider-name">{{ providerDisplayName(status.provider) }}</span>
          @if (status.installed) {
            <span class="badge badge-installed">Installed</span>
          } @else {
            <span class="badge badge-uninstalled">Not Detected</span>
          }
        </div>
        @if (status.version) {
          <span class="version-label">v{{ status.version }}</span>
        }
      </div>

      <div class="card-body">
        <div class="meta-row">
          <span class="meta-label">CLI Binary</span>
          <span class="meta-value font-mono truncate" [title]="status.executablePath || 'Not found in PATH'">
            {{ status.executablePath || 'Not detected in PATH' }}
          </span>
        </div>

        <div class="meta-row">
          <span class="meta-label">Authentication</span>
          <span class="meta-value">
            @switch (status.authentication.state) {
              @case ('authenticated') {
                <span class="badge badge-success">Authenticated</span>
              }
              @case ('unknown_until_run') {
                <span class="badge badge-warning" title="Auth will be checked during execution">Unknown Until Run</span>
              }
              @case ('unauthenticated') {
                <span class="badge badge-error">Unauthenticated</span>
              }
              @case ('error') {
                <span class="badge badge-error">Auth Error</span>
              }
            }
          </span>
        </div>
        @if (getAuthMessage()) {
          <div class="auth-message">{{ getAuthMessage() }}</div>
        }

        <div class="meta-row">
          <span class="meta-label">Catalog Discovery</span>
          <span class="meta-value">
            <span class="badge badge-discovery">
              {{ status.modelCatalog.discovery === 'dynamic' ? 'Dynamic' : 'Maintained' }}
            </span>
          </span>
        </div>

        <div class="models-section">
          <span class="models-header">MODELS ({{ status.modelCatalog.models.length }})</span>
          <div class="models-list">
            @for (m of status.modelCatalog.models; track m.id) {
              <div class="model-item" [class.disabled]="!m.available">
                <div class="model-info">
                  <span class="model-name">{{ m.label }}</span>
                  <span class="model-id font-mono">{{ m.id }}</span>
                </div>
                @if (m.available) {
                  <span class="model-status available">Ready</span>
                } @else {
                  <span class="model-status unavailable" [title]="m.unavailableReason || 'Unavailable'">
                    {{ m.unavailableReason || 'Unavailable' }}
                  </span>
                }
              </div>
            } @empty {
              <div class="empty-models">No models available</div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .provider-card {
      @include card-surface;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background-color: $bg-surface-2;

      &.uninstalled {
        opacity: 0.7;
        border-color: rgba(48, 54, 61, 0.6);
      }
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 10px;
      border-bottom: 1px solid $border-subtle;
    }

    .provider-title-row {
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

    .provider-name {
      font-size: 14px;
      font-weight: 600;
      color: $text-primary;
    }

    .version-label {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $text-secondary;
    }

    .card-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
    }

    .meta-label {
      color: $text-secondary;
    }

    .meta-value {
      max-width: 60%;
      text-align: right;
    }

    .font-mono {
      font-family: $font-mono;
    }

    .truncate {
      @include truncate;
    }

    .badge {
      @include mono-badge;
    }

    .badge-installed {
      background-color: rgba(63, 185, 80, 0.15);
      color: $status-clean;
      border: 1px solid rgba(63, 185, 80, 0.3);
    }

    .badge-uninstalled {
      background-color: $bg-surface-3;
      color: $text-muted;
      border: 1px solid $border-subtle;
    }

    .badge-success {
      background-color: rgba(63, 185, 80, 0.15);
      color: $status-clean;
    }

    .badge-warning {
      background-color: rgba(245, 158, 11, 0.15);
      color: $severity-medium;
    }

    .badge-error {
      background-color: rgba(248, 81, 73, 0.15);
      color: $severity-critical;
    }

    .badge-discovery {
      background-color: $bg-surface-3;
      color: $accent-primary;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .auth-message {
      font-size: 11px;
      color: $severity-medium;
      background: rgba(245, 158, 11, 0.08);
      padding: 4px 8px;
      border-radius: 4px;
    }

    .models-section {
      margin-top: 6px;
      padding-top: 10px;
      border-top: 1px solid $border-subtle;
    }

    .models-header {
      font-family: $font-mono;
      font-size: 10px;
      color: $text-muted;
      letter-spacing: 0.05em;
      margin-bottom: 6px;
      display: block;
    }

    .models-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 140px;
      overflow-y: auto;
    }

    .model-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      background-color: $bg-surface-1;
      border-radius: 4px;
      border: 1px solid $border-subtle;

      &.disabled {
        opacity: 0.6;
      }
    }

    .model-info {
      display: flex;
      flex-direction: column;
    }

    .model-name {
      font-size: 12px;
      font-weight: 500;
      color: $text-primary;
    }

    .model-id {
      font-size: 10px;
      color: $text-muted;
    }

    .model-status {
      @include mono-badge;

      &.available {
        color: $status-clean;
        background: rgba(63, 185, 80, 0.1);
      }

      &.unavailable {
        color: $text-muted;
        background: $bg-surface-3;
      }
    }

    .empty-models {
      font-size: 11px;
      color: $text-muted;
      padding: 8px 0;
    }
  `],
})
export class ProviderStatusCardComponent {
  @Input({ required: true }) status!: ProviderStatus;

  providerDisplayName(provider: string): string {
    switch (provider) {
      case 'claude':
        return 'Claude';
      case 'codex':
        return 'Codex';
      case 'gemini':
        return 'Gemini';
      default:
        return provider;
    }
  }

  getAuthMessage(): string | undefined {
    if (this.status?.authentication && 'message' in this.status.authentication) {
      return (this.status.authentication as { message?: string }).message;
    }
    return undefined;
  }
}
