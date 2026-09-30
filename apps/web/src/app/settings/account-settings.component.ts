import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthStore } from '../core/auth/auth.store';
import { ApiError } from '../core/api/api-error';

@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-card">
      <div class="card-header">
        <h2>Local Account & Master Password</h2>
        <p class="section-desc">
          Update the local master password for this machine. Changing the master password immediately invalidates all active sessions.
        </p>
      </div>

      @if (successMessage()) {
        <div class="success-banner" role="status">
          <span>✓</span>
          <span>{{ successMessage() }}</span>
        </div>
      }

      @if (errorMessage()) {
        <div class="error-banner" role="alert">
          <span>⚠</span>
          <span>{{ errorMessage() }}</span>
        </div>
      }

      <form (ngSubmit)="onChangePassword()" #form="ngForm">
        <div class="form-group">
          <label for="current-password">Current Master Password</label>
          <input
            id="current-password"
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            [(ngModel)]="currentPassword"
            required
            placeholder="Enter current password"
            [disabled]="loading()"
          />
        </div>

        <div class="form-group">
          <label for="new-password">New Master Password</label>
          <input
            id="new-password"
            name="newPassword"
            type="password"
            autocomplete="new-password"
            [(ngModel)]="newPassword"
            required
            minlength="12"
            placeholder="Minimum 12 characters"
            [disabled]="loading()"
          />
          <span class="field-hint">Must be at least 12 characters</span>
        </div>

        <div class="form-actions">
          <button
            type="submit"
            class="btn-primary"
            [disabled]="!isValid() || loading()"
          >
            @if (loading()) {
              <span>Updating Password...</span>
            } @else {
              <span>Change Master Password</span>
            }
          </button>
        </div>
      </form>
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

    .form-group {
      display: flex;
      flex-direction: column;
      margin-bottom: 16px;
      max-width: 400px;

      label {
        font-size: 12px;
        font-weight: 500;
        color: $text-primary;
        margin-bottom: 6px;
      }

      .field-hint {
        font-size: 11px;
        color: $text-muted;
        margin-top: 4px;
      }
    }

    .form-actions {
      margin-top: 20px;
    }
  `],
})
export class AccountSettingsComponent {
  private readonly authStore = inject(AuthStore);

  currentPassword = '';
  newPassword = '';
  loading = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  isValid(): boolean {
    return this.currentPassword.length >= 1 && this.newPassword.length >= 12;
  }

  async onChangePassword(): Promise<void> {
    if (!this.isValid() || this.loading()) {
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      await this.authStore.changePassword({
        currentPassword: this.currentPassword,
        newPassword: this.newPassword,
      });
      this.successMessage.set('Master password updated successfully. Active sessions revoked.');
      this.currentPassword = '';
      this.newPassword = '';
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        this.errorMessage.set(err.message);
      } else {
        this.errorMessage.set('Failed to change password');
      }
    } finally {
      this.loading.set(false);
    }
  }
}
