import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProviderQuota, ProviderStatus, QuotaWindow } from '@pr-orchestrator/contracts';

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

        <!-- Quota Section -->
        <div class="quota-section">
          <div class="quota-header">
            <span class="quota-title">ACCOUNT QUOTA & RATE LIMITS</span>
            @if (quota) {
              <div class="quota-badges">
                @if (isStale()) {
                  <span class="badge badge-stale" title="Snapshot expired or window reset passed">Stale</span>
                } @else if (quota.status === 'available') {
                  <span class="badge badge-fresh" title="Live/cached measurement">Fresh</span>
                }
                <span class="badge" [ngClass]="'badge-quota-' + quota.status">
                  {{ quota.status | uppercase }}
                </span>
              </div>
            }
          </div>

          @if (!quota) {
            <div class="quota-empty font-mono">Quota not probed</div>
          } @else {
            @if (quota.status === 'available' && quota.windows.length > 0) {
              <div class="quota-windows-list">
                @for (win of quota.windows; track win.poolId + ':' + win.window) {
                  <div class="quota-window-card">
                    <div class="window-title-row">
                      <span class="window-label font-mono">
                        {{ formatWindowLabel(win) }}
                      </span>
                      <span class="window-pool font-mono text-muted">
                        {{ win.poolId }} (shared pool)
                      </span>
                    </div>

                    <div class="window-metric-row">
                      @if (win.remainingPercent !== null) {
                        <div class="progress-bar-container">
                          <div
                            class="progress-bar"
                            [class.bar-ok]="win.remainingPercent > 50"
                            [class.bar-warning]="win.remainingPercent <= 50 && win.remainingPercent > 20"
                            [class.bar-critical]="win.remainingPercent <= 20"
                            [style.width.%]="win.remainingPercent"
                          ></div>
                        </div>
                        <span class="percent-val font-mono" [class.percent-depleted]="win.remainingPercent === 0">
                          {{ win.remainingPercent }}% remaining
                        </span>
                      } @else {
                        <span class="badge badge-unknown">Unavailable</span>
                      }
                    </div>

                    <div class="window-meta-row font-mono">
                      @if (isWindowResetPassed(win)) {
                        <span class="reset-time text-warning">Reset passed (pending refresh)</span>
                      } @else if (win.resetAt) {
                        <span class="reset-time text-muted">Resets {{ formatTime(win.resetAt) }}</span>
                      } @else {
                        <span class="reset-time text-muted">No scheduled reset</span>
                      }
                    </div>
                  </div>
                }
              </div>
            }

            @if (quota.status === 'unauthenticated') {
              <div class="quota-alert alert-unauthenticated">
                <span class="alert-icon">ℹ</span>
                <div>
                  <strong>CLI Authentication Required</strong>
                  <p>
                    {{ quota.message || 'Account login not detected.' }}
                    To authenticate, run <code class="font-mono">{{ status.provider }} login</code> in your local terminal.
                  </p>
                </div>
              </div>
            }

            @if (quota.status === 'unavailable') {
              <div class="quota-alert alert-unavailable">
                <span class="alert-icon">ℹ</span>
                <div>
                  <strong>No Machine-Readable Quota Source</strong>
                  <p>
                    {{ quota.message || 'This CLI version does not expose structured account quota.' }}
                    Interactive CLI commands (e.g. <code class="font-mono">/usage</code> or <code class="font-mono">/stats model</code>) may show session stats.
                  </p>
                </div>
              </div>
            }

            @if (quota.status === 'error') {
              <div class="quota-alert alert-error">
                <span class="alert-icon">⚠</span>
                <div>
                  <strong>Quota Check Failed</strong>
                  <p>{{ quota.message || 'Failed to read provider quota limits.' }}</p>
                </div>
              </div>
            }

            <div class="quota-telemetry font-mono">
              @if (quota.lastUpdatedAt) {
                <span>Updated: {{ formatTime(quota.lastUpdatedAt) }}</span>
              }
              <span>Checked: {{ formatTime(quota.checkedAt) }}</span>
            </div>
          }
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

    .quota-section {
      margin-top: 8px;
      padding-top: 12px;
      border-top: 1px solid $border-subtle;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .quota-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .quota-title {
      font-family: $font-mono;
      font-size: 10px;
      color: $text-muted;
      letter-spacing: 0.05em;
    }

    .quota-badges {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .badge-stale {
      background-color: rgba(245, 158, 11, 0.15);
      color: $severity-medium;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge-fresh {
      background-color: rgba(63, 185, 80, 0.15);
      color: $status-clean;
      border: 1px solid rgba(63, 185, 80, 0.3);
    }

    .badge-quota-available {
      background-color: rgba(63, 185, 80, 0.12);
      color: $status-clean;
    }

    .badge-quota-unavailable {
      background-color: $bg-surface-3;
      color: $text-muted;
    }

    .badge-quota-unauthenticated {
      background-color: rgba(245, 158, 11, 0.15);
      color: $severity-medium;
    }

    .badge-quota-error {
      background-color: rgba(248, 81, 73, 0.15);
      color: $severity-critical;
    }

    .badge-quota-stale {
      background-color: rgba(245, 158, 11, 0.15);
      color: $severity-medium;
    }

    .quota-empty {
      font-size: 11px;
      color: $text-muted;
      font-style: italic;
    }

    .quota-windows-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .quota-window-card {
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 4px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .window-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
    }

    .window-label {
      font-weight: 600;
      color: $text-primary;
    }

    .window-pool {
      font-size: 10px;
    }

    .window-metric-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .progress-bar-container {
      flex: 1;
      height: 6px;
      background-color: $bg-surface-3;
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;

      &.bar-ok {
        background-color: $status-clean;
      }

      &.bar-warning {
        background-color: $severity-medium;
      }

      &.bar-critical {
        background-color: $severity-critical;
      }
    }

    .percent-val {
      font-size: 11px;
      font-weight: 600;
      color: $text-primary;
      white-space: nowrap;

      &.percent-depleted {
        color: $severity-critical;
      }
    }

    .badge-unknown {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $text-muted;
    }

    .window-meta-row {
      font-size: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;

      .text-warning {
        color: $severity-medium;
      }
    }

    .quota-alert {
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 11px;
      display: flex;
      gap: 8px;
      align-items: flex-start;

      strong {
        display: block;
        margin-bottom: 2px;
      }

      p {
        margin: 0;
        line-height: 1.4;
      }

      code {
        padding: 1px 4px;
        background-color: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
      }

      &.alert-unauthenticated {
        background-color: rgba(245, 158, 11, 0.08);
        border: 1px solid rgba(245, 158, 11, 0.25);
        color: $severity-medium;
        p { color: $text-secondary; }
      }

      &.alert-unavailable {
        background-color: rgba(140, 149, 159, 0.08);
        border: 1px solid rgba(140, 149, 159, 0.2);
        color: $text-secondary;
      }

      &.alert-error {
        background-color: rgba(248, 81, 73, 0.08);
        border: 1px solid rgba(248, 81, 73, 0.25);
        color: $severity-critical;
        p { color: $text-secondary; }
      }
    }

    .quota-telemetry {
      font-size: 10px;
      color: $text-muted;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }
  `],
})
export class ProviderStatusCardComponent {
  @Input({ required: true }) status!: ProviderStatus;
  @Input() quota?: ProviderQuota;

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

  formatDuration(minutes: number | null): string {
    if (minutes === null || minutes <= 0) return '';
    if (minutes < 60) return `${minutes}m`;
    if (minutes % 1440 === 0) return `${minutes / 1440}d`;
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    const hours = Math.floor(minutes / 60);
    const remMins = minutes % 60;
    return `${hours}h ${remMins}m`;
  }

  formatWindowLabel(win: QuotaWindow): string {
    const slot = win.window === 'primary' ? 'Primary' : 'Secondary';
    const dur = this.formatDuration(win.windowDurationMins);
    return dur ? `${slot} (${dur})` : slot;
  }

  isWindowResetPassed(win: QuotaWindow): boolean {
    if (!win.resetAt) return false;
    return new Date(win.resetAt).getTime() <= Date.now();
  }

  isStale(): boolean {
    if (!this.quota) return false;
    if (this.quota.status === 'stale') return true;
    if (this.quota.expiresAt && new Date(this.quota.expiresAt).getTime() <= Date.now()) {
      return true;
    }
    return this.quota.windows.some((w) => this.isWindowResetPassed(w));
  }

  formatTime(isoUtc: string | null): string {
    if (!isoUtc) return 'Unavailable';
    try {
      const d = new Date(isoUtc);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoUtc;
    }
  }
}
