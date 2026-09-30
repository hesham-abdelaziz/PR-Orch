import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthStore } from '../core/auth/auth.store';
import { ApiError } from '../core/api/api-error';

@Component({
  selector: 'app-login-page',
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
          <h1>Sign In</h1>
          <p class="auth-subtitle">
            Local session authentication for <code>127.0.0.1</code>.
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
              placeholder="Username"
              [disabled]="submitting()"
            />
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              [(ngModel)]="password"
              required
              placeholder="Password"
              [disabled]="submitting()"
            />
          </div>

          <div class="form-actions">
            <button
              type="submit"
              class="btn-primary submit-btn"
              [disabled]="!isFormValid() || submitting()"
            >
              @if (submitting()) {
                <span>Authenticating...</span>
              } @else {
                <span>Sign In</span>
              }
            </button>
          </div>
        </form>

        <div class="security-note">
          <span>🔒 Read-only Azure DevOps client. Local Windows session.</span>
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
      max-width: 420px;
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

    h1 {
      font-size: 18px;
      font-weight: 600;
      color: $text-primary;
      margin-bottom: 6px;
    }

    .auth-subtitle {
      font-size: 12px;
      color: $text-secondary;

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
export class LoginPageComponent {
  private readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);

  username = '';
  password = '';
  submitting = signal(false);
  errorMessage = signal<string | null>(null);

  isFormValid(): boolean {
    return this.username.trim().length >= 1 && this.password.length >= 1;
  }

  async onSubmit(): Promise<void> {
    if (!this.isFormValid() || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);

    try {
      await this.authStore.login({
        username: this.username.trim(),
        password: this.password,
      });
      await this.router.navigate(['/reviews/new']);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        this.errorMessage.set(err.message);
      } else {
        this.errorMessage.set('Invalid credentials');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
