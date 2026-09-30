import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AzureAuthStatus,
  AzureAuthStatusSchema,
  Settings,
  SettingsSchema,
  UpdateSettingsRequestSchema,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../core/api/api-client.service';
import { ApiError } from '../core/api/api-error';
import { ProvidersStore } from '../providers/providers.store';
import { ProviderSettingsComponent } from './provider-settings.component';
import { AzureAuthSettingsComponent } from './azure-auth-settings.component';
import { ReviewDefaultsComponent } from './review-defaults.component';
import { AccountSettingsComponent } from './account-settings.component';

export type SettingsTab = 'providers' | 'azure' | 'defaults' | 'security';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [
    CommonModule,
    ProviderSettingsComponent,
    AzureAuthSettingsComponent,
    ReviewDefaultsComponent,
    AccountSettingsComponent,
  ],
  template: `
    <div class="settings-page">
      <div class="page-header">
        <div>
          <div class="breadcrumbs font-mono">
            <span>system</span> / <span>runtime-config</span> / <span class="active">settings</span>
          </div>
          <h1>Settings</h1>
          <p class="header-desc">
            Manage local AI CLI integrations, Azure DevOps credentials, engineering standards, and execution defaults.
          </p>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="tabs-nav" role="tablist">
        <button
          type="button"
          class="tab-btn"
          role="tab"
          [class.active]="activeTab() === 'providers'"
          [attr.aria-selected]="activeTab() === 'providers'"
          (click)="activeTab.set('providers')"
        >
          <span class="tab-icon">◈</span>
          <span>Local AI Providers</span>
        </button>

        <button
          type="button"
          class="tab-btn"
          role="tab"
          [class.active]="activeTab() === 'azure'"
          [attr.aria-selected]="activeTab() === 'azure'"
          (click)="activeTab.set('azure')"
        >
          <span class="tab-icon">🔑</span>
          <span>Azure DevOps PAT</span>
        </button>

        <button
          type="button"
          class="tab-btn"
          role="tab"
          [class.active]="activeTab() === 'defaults'"
          [attr.aria-selected]="activeTab() === 'defaults'"
          (click)="activeTab.set('defaults')"
        >
          <span class="tab-icon">⚙</span>
          <span>Review Defaults</span>
        </button>

        <button
          type="button"
          class="tab-btn"
          role="tab"
          [class.active]="activeTab() === 'security'"
          [attr.aria-selected]="activeTab() === 'security'"
          (click)="activeTab.set('security')"
        >
          <span class="tab-icon">🔒</span>
          <span>Account & Security</span>
        </button>
      </div>

      @if (errorMessage()) {
        <div class="error-banner" role="alert">
          <span>⚠</span>
          <span>{{ errorMessage() }}</span>
        </div>
      }

      @if (successMessage()) {
        <div class="success-banner" role="status">
          <span>✓</span>
          <span>{{ successMessage() }}</span>
        </div>
      }

      <!-- Tab Content Panels -->
      <div class="tab-content">
        @switch (activeTab()) {
          @case ('providers') {
            <app-provider-settings />
          }
          @case ('azure') {
            <app-azure-auth-settings
              [status]="azureAuthStatus()"
              [testResult]="azureTestResult()"
              (savePat)="onSaveAzurePat($event)"
              (deletePat)="onDeleteAzurePat()"
              (testConnection)="onTestAzureConnection()"
            />
          }
          @case ('defaults') {
            @if (settings()) {
              <app-review-defaults
                [settings]="settings()"
                [availableModels]="providersStore.selectableModels()"
                [saving]="savingSettings()"
                (save)="onSaveSettings($event)"
              />
            } @else {
              <div class="loading-state">Loading settings...</div>
            }
          }
          @case ('security') {
            <app-account-settings />
          }
        }
      </div>
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .settings-page {
      padding: 24px 32px;
      max-width: 1200px;
    }

    .page-header {
      margin-bottom: 24px;

      .breadcrumbs {
        font-size: 11px;
        color: $text-muted;
        margin-bottom: 8px;

        .active {
          color: $accent-primary;
        }
      }

      h1 {
        font-size: 20px;
        font-weight: 700;
        color: $text-primary;
        margin-bottom: 6px;
      }

      .header-desc {
        font-size: 13px;
        color: $text-secondary;
      }
    }

    .tabs-nav {
      display: flex;
      gap: 6px;
      background-color: $bg-surface-1;
      padding: 4px;
      border-radius: 8px;
      border: 1px solid $border-subtle;
      margin-bottom: 24px;
      overflow-x: auto;
    }

    .tab-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-radius: 6px;
      background: transparent;
      border: none;
      color: $text-secondary;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;

      .tab-icon {
        font-size: 12px;
      }

      &:hover {
        background-color: $bg-surface-2;
        color: $text-primary;
      }

      &.active {
        background-color: $bg-surface-3;
        color: $accent-primary;
        font-weight: 600;
      }
    }

    .success-banner {
      background-color: rgba(63, 185, 80, 0.15);
      border: 1px solid rgba(63, 185, 80, 0.4);
      color: #9df2a6;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 12px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tab-content {
      margin-top: 8px;
    }

    .loading-state {
      @include card-surface;
      padding: 32px;
      text-align: center;
      color: $text-muted;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class SettingsPageComponent implements OnInit {
  private readonly apiClient = inject(ApiClientService);
  readonly providersStore = inject(ProvidersStore);

  activeTab = signal<SettingsTab>('providers');
  settings = signal<Settings | null>(null);
  azureAuthStatus = signal<AzureAuthStatus | null>(null);
  azureTestResult = signal<{ ok: boolean; message: string } | null>(null);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  savingSettings = signal<boolean>(false);

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.loadSettings(),
      this.loadAzureAuthStatus(),
      this.providersStore.load().catch(() => {}),
    ]);
  }

  async loadSettings(): Promise<void> {
    try {
      const data = await this.apiClient.request({
        method: 'GET',
        path: '/api/settings',
        schema: SettingsSchema,
      });
      this.settings.set(data);
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to load settings');
    }
  }

  async loadAzureAuthStatus(): Promise<void> {
    try {
      const data = await this.apiClient.request({
        method: 'GET',
        path: '/api/settings/azure-auth',
        schema: AzureAuthStatusSchema,
      });
      this.azureAuthStatus.set(data);
    } catch {
      this.azureAuthStatus.set({
        method: 'unavailable',
        configured: false,
        reason: 'pat_missing_and_azure_cli_unavailable',
      });
    }
  }

  async onSaveAzurePat(pat: string): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      const data = await this.apiClient.request({
        method: 'PUT',
        path: '/api/settings/azure-pat',
        body: { pat },
        schema: AzureAuthStatusSchema,
      });
      this.azureAuthStatus.set(data);
      this.successMessage.set('Personal Access Token saved to Windows Credential Manager.');
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to save PAT');
    }
  }

  async onDeleteAzurePat(): Promise<void> {
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      const data = await this.apiClient.request({
        method: 'DELETE',
        path: '/api/settings/azure-pat',
        schema: AzureAuthStatusSchema,
      });
      this.azureAuthStatus.set(data);
      this.successMessage.set('Personal Access Token removed.');
    } catch (err: unknown) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to remove PAT');
    }
  }

  async onTestAzureConnection(): Promise<void> {
    this.errorMessage.set(null);
    try {
      const res = await this.apiClient.request<{ ok: boolean; message: string }>({
        method: 'POST',
        path: '/api/settings/azure-auth/test',
      });
      this.azureTestResult.set(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      this.azureTestResult.set({ ok: false, message: msg });
    }
  }

  async onSaveSettings(updated: Settings): Promise<void> {
    this.savingSettings.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);
    try {
      UpdateSettingsRequestSchema.parse(updated);
      const res = await this.apiClient.request({
        method: 'PUT',
        path: '/api/settings',
        body: updated,
        schema: SettingsSchema,
      });
      this.settings.set(res);
      this.successMessage.set('Review defaults saved successfully.');
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        this.errorMessage.set(err.message);
      } else {
        this.errorMessage.set(err instanceof Error ? err.message : 'Failed to save settings');
      }
    } finally {
      this.savingSettings.set(false);
    }
  }

  async saveSettings(): Promise<void> {
    if (this.settings()) {
      await this.onSaveSettings(this.settings()!);
    }
  }
}
