import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthStore } from '../core/auth/auth.store';
import { ApiError } from '../core/api/api-error';

@Component({
  selector: 'app-setup-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <div class="logo-mark">
            <span class="logo-icon">◈</span>
            <span class="logo-title">PR Review Orchestrator</span>
          </div>
          <span class="setup-badge">FIRST-RUN INITIALIZATION</span>
          <h1>Initialize Local Account</h1>
          <p class="auth-subtitle">
            Configure your local credentials. The orchestrator runs on <code>127.0.0.1</code> and stores credentials securely on this machine.
          </p>
        </div>

        @if (errorMessage()) {
          <div class="error-banner" role="alert">
            <span class="error-icon">⚠</span>
            <span>{{ errorMessage() }}</span>
          </div>
        }

        <form (ngSubmit)="onSubmit()" #form="ngForm" novalidate>
          <div class="form-group">
            <label for="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autocomplete="username"
              [(ngModel)]="username"
              required
              maxlength="64"
              placeholder="e.g. dev-lead"
              [disabled]="submitting()"
            />
            <span class="field-hint">1 to 64 characters</span>
          </div>

          <div class="form-group">
            <label for="password">Master Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="new-password"
              [(ngModel)]="password"
              required
              minlength="12"
              maxlength="256"
              placeholder="Minimum 12 characters"
              [disabled]="submitting()"
            />
            <span class="field-hint">Must be at least 12 characters</span>
          </div>

          <div class="form-actions">
            <button
              type="submit"
              class="btn-primary submit-btn"
              [disabled]="!isFormValid() || submitting()"
            >
              @if (submitting()) {
                <span>Initializing...</span>
              } @else {
                <span>Create Local Account</span>
              }
            </button>
          </div>
        </form>

        <div class="security-note">
          <span>🔒 Read-only Azure DevOps client. Passwords hashed using Argon2id.</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .auth-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background-color: $bg-canvas;
      padding: 24px;
    }

    .auth-card {
      @include card-surface;
      width: 100%;
      max-width: 440px;
      padding: 32px;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
    }

    .auth-header {
      margin-bottom: 24px;
    }

    .logo-mark {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      color: $accent-primary;
      font-weight: 600;
      font-size: 14px;
    }

    .setup-badge {
      @include mono-badge;
      background-color: rgba(163, 113, 247, 0.15);
      color: $accent-verifier;
      border: 1px solid rgba(163, 113, 247, 0.3);
      margin-bottom: 12px;
    }

    h1 {
      font-size: 18px;
      font-weight: 600;
      color: $text-primary;
      margin-bottom: 8px;
    }

    .auth-subtitle {
      font-size: 12px;
      color: $text-secondary;
      line-height: 1.5;

      code {
        color: $accent-primary;
        background: $bg-surface-3;
        padding: 2px 4px;
        border-radius: 3px;
      }
    }

    .form-group {
      display: flex;
      flex-direction: column;
      margin-bottom: 18px;

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

    .submit-btn {
      width: 100%;
      padding: 10px;
      font-size: 13px;
      margin-top: 8px;
    }

    .security-note {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid $border-subtle;
      font-size: 11px;
      color: $text-muted;
      text-align: center;
    }
  `],
})
export class SetupPageComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  username = '';
  password = '';
  submitting = signal(false);
  errorMessage = signal<string | null>(null);

  isFormValid(): boolean {
    return (
      this.username.trim().length >= 1 &&
      this.username.trim().length <= 64 &&
      this.password.length >= 12 &&
      this.password.length <= 256
    );
  }

  async onSubmit(): Promise<void> {
    if (!this.isFormValid() || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    try {
      await this.authStore.setup({
        username: this.username.trim(),
        password: this.password,
      });
      await this.router.navigate(['/reviews/new']);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        this.errorMessage.set(err.message);
      } else {
        this.errorMessage.set('Failed to initialize account');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
