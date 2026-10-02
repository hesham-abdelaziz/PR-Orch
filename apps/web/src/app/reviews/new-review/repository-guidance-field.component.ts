import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RepositoryGuidance } from '@pr-orchestrator/contracts';

@Component({
  selector: 'app-repository-guidance-field',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="guidance-card">
      <div class="guidance-header">
        <div class="header-left">
          <span class="step-num">05</span>
          <div>
            <div class="title-row">
              <h2>Repository Guidance (Optional)</h2>
              <span class="badge font-mono">OPTIONAL</span>
            </div>
            <p class="section-desc">
              Used by all models for this review's selected repository.
            </p>
          </div>
        </div>
      </div>

      <div class="guidance-body">
        @if (reading) {
          <div class="status-indicator font-mono" role="status">
            <span class="pulse-dot"></span>
            <span>Reading guidance file...</span>
          </div>
        }

        @if (error) {
          <div class="error-banner font-mono" role="alert">
            <span class="error-glyph">⚠</span>
            <span class="error-msg">{{ error }}</span>
            <button
              type="button"
              class="btn-clear-error font-mono"
              (click)="onRemove()"
              aria-label="Clear guidance error"
            >
              Clear
            </button>
          </div>
        }

        @if (guidance) {
          <div class="attached-file-box">
            <div class="file-details">
              <span class="file-icon font-mono">📄</span>
              <div class="file-text">
                <span class="filename font-mono">{{ guidance.filename }}</span>
                <span class="filesize font-mono text-muted">({{ formatBytes(fileSize) }})</span>
              </div>
            </div>
            <button
              id="remove-guidance-btn"
              type="button"
              class="btn-remove font-mono"
              (click)="onRemove()"
              aria-label="Remove repository guidance file"
            >
              Remove
            </button>
          </div>
        } @else {
          <div class="picker-section">
            <label
              for="guidance-file-input"
              class="btn-picker font-mono"
              [class.disabled]="reading"
              tabindex="0"
              (keydown.enter)="fileInput.click()"
              (keydown.space)="fileInput.click(); $event.preventDefault()"
            >
              <span>Attach Guidance File (.md / .txt)</span>
            </label>
            <input
              #fileInput
              id="guidance-file-input"
              type="file"
              accept=".md,.txt,text/markdown,text/plain"
              class="hidden-file-input"
              (change)="onFileChange($event)"
              [disabled]="reading"
              aria-label="Repository guidance file"
            />
            <span class="picker-hint font-mono text-muted">
              UTF-8, max 64 KiB (.md / .txt e.g. Claude.md, AGENTS.md, GEMINI.md)
            </span>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .guidance-card {
      @include card-surface;
      padding: 20px;
    }

    .guidance-header {
      margin-bottom: 16px;
    }

    .header-left {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 4px;
      background-color: $bg-surface-3;
      color: $text-secondary;
      font-family: $font-mono;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;

      h2 {
        font-size: 14px;
        font-weight: 600;
        color: $text-primary;
      }
    }

    .section-desc {
      font-size: 12px;
      color: $text-secondary;
    }

    .badge {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $text-muted;
    }

    .guidance-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .status-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: $accent-primary;
      padding: 8px 12px;
      background-color: rgba(56, 189, 248, 0.1);
      border-radius: 6px;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: $accent-primary;
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .error-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      background-color: rgba(248, 81, 73, 0.12);
      border: 1px solid rgba(248, 81, 73, 0.35);
      color: $severity-critical;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;

      .error-glyph {
        font-size: 14px;
      }

      .error-msg {
        flex: 1;
      }
    }

    .btn-clear-error {
      background: none;
      border: 1px solid rgba(248, 81, 73, 0.4);
      color: $severity-critical;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;

      &:hover {
        background-color: rgba(248, 81, 73, 0.15);
      }
    }

    .attached-file-box {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 14px;
      background-color: $bg-surface-2;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      gap: 12px;
    }

    .file-details {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .file-icon {
      font-size: 16px;
    }

    .file-text {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }

    .filename {
      font-size: 13px;
      font-weight: 600;
      color: $text-primary;
      word-break: break-all;
    }

    .filesize {
      font-size: 11px;
      color: $text-muted;
      flex-shrink: 0;
    }

    .btn-remove {
      background-color: transparent;
      border: 1px solid $border-subtle;
      color: $text-secondary;
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      flex-shrink: 0;

      &:hover {
        background-color: rgba(248, 81, 73, 0.12);
        color: $severity-critical;
        border-color: rgba(248, 81, 73, 0.3);
      }
    }

    .picker-section {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }

    .btn-picker {
      display: inline-flex;
      align-items: center;
      padding: 8px 16px;
      background-color: $bg-surface-3;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      color: $text-primary;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;

      &:hover:not(.disabled) {
        background-color: $bg-surface-2;
        border-color: $accent-primary;
        color: $accent-primary;
      }

      &.disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      &:focus-visible {
        outline: 2px solid $accent-primary;
        outline-offset: 2px;
      }
    }

    .hidden-file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      border: 0;
    }

    .picker-hint {
      font-size: 11px;
      color: $text-muted;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class RepositoryGuidanceFieldComponent {
  @Input() guidance: RepositoryGuidance | null = null;
  @Input() fileSize = 0;
  @Input() reading = false;
  @Input() error: string | null = null;

  @Output() fileSelected = new EventEmitter<File>();
  @Output() remove = new EventEmitter<void>();

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      this.fileSelected.emit(file);
    }
    input.value = '';
  }

  onRemove(): void {
    this.remove.emit();
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
}
