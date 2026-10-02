import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { APP_VERSION } from '../release/release-info.generated';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <aside class="sidebar" aria-label="Main Navigation">
      <div class="brand">
        <span class="brand-glyph">◈</span>
        <div class="brand-text">
          <span class="brand-name">PR Orchestrator</span>
          <span class="brand-version">v{{ appVersion }} • localhost</span>
        </div>
      </div>

      <nav class="nav-menu">
        <span class="nav-section-label">WORKFLOW</span>
        <a
          routerLink="/reviews/new"
          routerLinkActive="active"
          class="nav-link"
          id="nav-new-review"
        >
          <span class="nav-icon">＋</span>
          <span class="nav-label">New Review</span>
        </a>

        <a
          routerLink="/reviews/history"
          routerLinkActive="active"
          class="nav-link"
          id="nav-history"
        >
          <span class="nav-icon">◷</span>
          <span class="nav-label">Review History</span>
        </a>

        <span class="nav-section-label">CONFIGURATION</span>
        <a
          routerLink="/standards"
          routerLinkActive="active"
          class="nav-link"
          id="nav-standards"
        >
          <span class="nav-icon">§</span>
          <span class="nav-label">Standards</span>
        </a>

        <a
          routerLink="/settings"
          routerLinkActive="active"
          class="nav-link"
          id="nav-settings"
        >
          <span class="nav-icon">⚙</span>
          <span class="nav-label">Settings</span>
        </a>

        <span class="nav-section-label">ABOUT</span>
        <a
          routerLink="/release-notes"
          routerLinkActive="active"
          class="nav-link"
          id="nav-release-notes"
        >
          <span class="nav-icon">▤</span>
          <span class="nav-label">Release Notes</span>
        </a>
      </nav>

      <div class="sidebar-footer">
        <div class="security-chip">
          <span class="security-dot">●</span>
          <div class="security-details">
            <span class="security-title">Local Read-Only</span>
            <span class="security-desc">No push/comments/mutation</span>
          </div>
        </div>
      </div>
    </aside>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .sidebar {
      width: $sidebar-width;
      height: 100vh;
      background-color: $bg-surface-1;
      border-right: 1px solid $border-default;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      user-select: none;
    }

    .brand {
      height: $header-height;
      padding: 0 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid $border-subtle;
    }

    .brand-glyph {
      color: $accent-primary;
      font-size: 16px;
      font-weight: bold;
    }

    .brand-text {
      display: flex;
      flex-direction: column;
    }

    .brand-name {
      font-size: 13px;
      font-weight: 600;
      color: $text-primary;
      letter-spacing: -0.01em;
    }

    .brand-version {
      font-family: $font-mono;
      font-size: 10px;
      color: $text-muted;
    }

    .nav-menu {
      flex: 1;
      padding: 16px 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .nav-section-label {
      font-family: $font-mono;
      font-size: 10px;
      font-weight: 600;
      color: $text-muted;
      padding: 8px 10px 4px;
      letter-spacing: 0.05em;
    }

    .nav-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 6px;
      color: $text-secondary;
      font-size: 12px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.15s ease;

      .nav-icon {
        font-size: 14px;
        color: $text-muted;
        width: 16px;
        text-align: center;
      }

      &:hover {
        background-color: $bg-surface-3;
        color: $text-primary;
        text-decoration: none;

        .nav-icon {
          color: $text-primary;
        }
      }

      &.active {
        background-color: $accent-primary-bg;
        color: $accent-primary;
        font-weight: 600;

        .nav-icon {
          color: $accent-primary;
        }
      }
    }

    .sidebar-footer {
      padding: 12px;
      border-top: 1px solid $border-subtle;
    }

    .security-chip {
      background-color: $bg-surface-2;
      border: 1px solid $border-subtle;
      padding: 8px 10px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .security-dot {
      color: $status-clean;
      font-size: 10px;
    }

    .security-details {
      display: flex;
      flex-direction: column;
    }

    .security-title {
      font-size: 11px;
      font-weight: 600;
      color: $text-primary;
    }

    .security-desc {
      font-size: 10px;
      color: $text-muted;
    }
  `],
})
export class SidebarComponent {
  readonly appVersion = APP_VERSION;
}
