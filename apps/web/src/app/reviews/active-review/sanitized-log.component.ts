import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sanitized-log',
  standalone: true,
  imports: [CommonModule],
  template: `
    <details class="sanitized-log" [open]="isOpen">
      <summary class="log-summary">
        <span class="summary-arrow">▶</span>
        <span class="summary-title font-mono">{{ title || 'Sanitized CLI Log' }}</span>
      </summary>
      <div class="log-wrapper">
        @if (content) {
          <pre class="log-content font-mono">{{ content }}</pre>
        } @else {
          <div class="log-empty font-mono">No process output captured.</div>
        }
      </div>
    </details>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .sanitized-log {
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;

      &[open] {
        .summary-arrow {
          transform: rotate(90deg);
        }
      }
    }

    .log-summary {
      padding: 6px 10px;
      font-size: 11px;
      color: $text-secondary;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      background-color: $bg-surface-2;
      list-style: none;

      &::-webkit-details-marker {
        display: none;
      }

      &:hover {
        color: $text-primary;
      }
    }

    .summary-arrow {
      font-size: 8px;
      color: $text-muted;
      transition: transform 0.15s ease;
    }

    .summary-title {
      letter-spacing: 0.02em;
    }

    .log-wrapper {
      padding: 8px 12px;
      background-color: $bg-surface-1;
      max-height: 200px;
      overflow-y: auto;
    }

    .log-content {
      font-size: 11px;
      line-height: 1.45;
      color: $text-primary;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .log-empty {
      font-size: 11px;
      color: $text-muted;
      font-style: italic;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class SanitizedLogComponent {
  @Input() content: string | null = null;
  @Input() title = 'Sanitized CLI Log';
  @Input() isOpen = false;
}
