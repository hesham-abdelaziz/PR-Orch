import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-top-status-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="top-bar">
      <div class="status-left">
        <span class="read-only-badge">
          <span class="badge-dot">●</span>
          Azure DevOps: Read-Only
        </span>
        <span class="host-pill">127.0.0.1</span>
      </div>

      <div class="status-right">
        @if (username) {
          <div class="user-chip">
            <span class="user-icon">👤</span>
            <span class="username">{{ username }}</span>
          </div>
        }

        <button
          type="button"
          id="logout-btn"
          class="logout-button"
          (click)="onLogoutClick()"
          title="Sign out of local session"
        >
          Sign Out
        </button>
      </div>
    </header>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .top-bar {
      height: $header-height;
      background-color: $bg-surface-1;
      border-bottom: 1px solid $border-default;
      padding: 0 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .status-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .badge-dot {
      color: $status-clean;
      font-size: 8px;
    }

    .host-pill {
      @include mono-badge;
      background-color: $bg-surface-2;
      color: $text-secondary;
      border: 1px solid $border-subtle;
    }

    .status-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .user-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: $text-primary;
      font-weight: 500;
    }

    .user-icon {
      font-size: 12px;
    }

    .logout-button {
      background: transparent;
      border: 1px solid $border-subtle;
      color: $text-secondary;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 4px;
      transition: all 0.15s ease;

      &:hover {
        background-color: $bg-surface-3;
        color: $text-primary;
        border-color: $border-default;
      }
    }
  `],
})
export class TopStatusBarComponent {
  @Input() username: string | null = null;
  @Output() logout = new EventEmitter<void>();

  onLogoutClick(): void {
    this.logout.emit();
  }
}
