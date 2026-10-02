import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SafeMarkdownComponent } from '../reviews/report/safe-markdown.component';
import { APP_VERSION, APP_CHANGELOG } from './release-info.generated';

@Component({
  selector: 'app-release-notes-page',
  standalone: true,
  imports: [CommonModule, RouterModule, SafeMarkdownComponent],
  template: `
    <div class="release-notes-page" role="region" aria-label="Release Notes Page">
      <div class="page-header">
        <nav aria-label="Breadcrumb" class="breadcrumbs font-mono">
          <span>system</span> / <span>about</span> / <span class="active">release-notes</span>
        </nav>
        <div class="header-title-row">
          <h1>Release Notes</h1>
          <span class="version-badge font-mono" id="release-version-badge">v{{ version }}</span>
        </div>
        <p class="header-desc">
          Application changelog, release history, and version details for PR Orchestrator.
        </p>
      </div>

      <div class="release-notes-card">
        <app-safe-markdown [markdown]="changelog" />
      </div>
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .release-notes-page {
      padding: 24px 32px;
      max-width: 960px;
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

      .header-title-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 6px;
      }

      h1 {
        font-size: 20px;
        font-weight: 700;
        color: $text-primary;
        margin: 0;
      }

      .version-badge {
        @include mono-badge;
        background-color: $bg-surface-3;
        color: $accent-primary;
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid $border-subtle;
      }

      .header-desc {
        font-size: 13px;
        color: $text-secondary;
        max-width: 720px;
        margin: 0;
      }
    }

    .release-notes-card {
      @include card-surface;
      padding: 28px 32px;
      background-color: $bg-surface-1;
      border: 1px solid $border-default;
      border-radius: 8px;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReleaseNotesPageComponent {
  readonly version = APP_VERSION;
  readonly changelog = APP_CHANGELOG;
}
