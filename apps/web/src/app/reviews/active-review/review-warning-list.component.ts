import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-review-warning-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (warnings.length > 0) {
      <div class="warnings-card" role="region" aria-label="Review warnings">
        <div class="warnings-header">
          <span class="warning-icon">⚠</span>
          <span class="warning-title font-mono">PIPELINE NOTICES & WARNINGS ({{ warnings.length }})</span>
        </div>
        <ul class="warnings-list">
          @for (warning of warnings; track $index) {
            <li class="warning-item">
              <span class="bullet">•</span>
              <span>{{ warning }}</span>
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .warnings-card {
      @include card-surface;
      background-color: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .warnings-header {
      display: flex;
      align-items: center;
      gap: 8px;
      color: $severity-medium;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.03em;
    }

    .warning-icon {
      font-size: 14px;
    }

    .warnings-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .warning-item {
      font-size: 12px;
      color: $text-primary;
      display: flex;
      align-items: flex-start;
      gap: 6px;
      line-height: 1.4;

      .bullet {
        color: $severity-medium;
      }
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReviewWarningListComponent {
  @Input() warnings: string[] = [];
}
