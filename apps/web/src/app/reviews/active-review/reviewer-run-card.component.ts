import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReviewJob } from '@pr-orchestrator/contracts';
import { SanitizedLogComponent } from './sanitized-log.component';

export type ReviewerRun = ReviewJob['reviewers'][number] & {
  attempts?: number;
  role?: string;
  sanitizedLog?: string | null;
  exitCode?: number | null;
};

@Component({
  selector: 'app-reviewer-run-card',
  standalone: true,
  imports: [CommonModule, SanitizedLogComponent],
  template: `
    <div class="reviewer-card" [class]="'state-' + run.state">
      <div class="card-header">
        <div class="model-info">
          <span class="provider-glyph" [class]="run.selection.provider">●</span>
          <div class="meta-texts">
            <div class="name-row">
              <span class="model-name font-mono">{{ run.selection.model }}</span>
              <span class="provider-badge font-mono">{{ run.selection.provider | uppercase }}</span>
            </div>
            <span class="role-desc">{{ isVerifier ? 'Main Verifier Unit' : 'Parallel Reviewer Unit' }}</span>
          </div>
        </div>

        <div class="state-container">
          @if (isVerifierNotRun) {
            <span class="badge badge-not-run font-mono">
              <span>⊘</span>
              <span>Not run</span>
            </span>
          } @else {
            @switch (run.state) {
              @case ('running') {
                <span class="badge badge-running font-mono">
                  <span class="pulse-dot"></span>
                  <span>RUNNING</span>
                </span>
              }
              @case ('completed') {
                <span class="badge badge-completed font-mono">
                  <span>✓</span>
                  <span>COMPLETED</span>
                </span>
              }
              @case ('failed') {
                <span class="badge badge-failed font-mono">
                  <span>✕</span>
                  <span>FAILED</span>
                </span>
              }
              @case ('timed_out') {
                <span class="badge badge-timeout font-mono">
                  <span>⏱</span>
                  <span>TIMED OUT</span>
                </span>
              }
              @case ('cancelled') {
                <span class="badge badge-cancelled font-mono">
                  <span>⊘</span>
                  <span>CANCELLED</span>
                </span>
              }
              @default {
                <span class="badge badge-queued font-mono">
                  <span>⋯</span>
                  <span>QUEUED</span>
                </span>
              }
            }
          }
        </div>
      </div>

      @if (run.warning) {
        <div class="run-warning" role="alert">
          <span class="warning-glyph">⚠</span>
          <span class="warning-msg">{{ run.warning }}</span>
        </div>
      }

      <!-- Collapsed sanitized log -->
      <app-sanitized-log
        [title]="logTitle"
        [content]="logContent"
        [isOpen]="false"
      />
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .reviewer-card {
      @include card-surface;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background-color: $bg-surface-2;
      border: 1px solid $border-subtle;
      transition: all 0.15s ease;

      &.state-running {
        border-color: rgba(56, 189, 248, 0.4);
        background-color: rgba(22, 27, 34, 0.9);
      }

      &.state-failed, &.state-timed_out {
        border-color: rgba(248, 81, 73, 0.3);
      }

      &.state-completed {
        border-color: rgba(63, 185, 80, 0.3);
      }
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .model-info {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .provider-glyph {
      font-size: 10px;

      &.claude { color: $provider-claude; }
      &.codex { color: $provider-codex; }
      &.gemini { color: $provider-gemini; }
    }

    .meta-texts {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .name-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .model-name {
      font-size: 13px;
      font-weight: 600;
      color: $text-primary;
    }

    .provider-badge {
      @include mono-badge;
      background-color: $bg-surface-3;
      color: $text-secondary;
      font-size: 10px;
    }

    .role-desc {
      font-size: 11px;
      color: $text-muted;
    }

    .badge {
      @include mono-badge;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .badge-running {
      background-color: rgba(56, 189, 248, 0.15);
      color: $accent-primary;
      border: 1px solid rgba(56, 189, 248, 0.4);
    }

    .pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: $accent-primary;
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
      100% { opacity: 1; transform: scale(1); }
    }

    .badge-completed {
      background-color: rgba(63, 185, 80, 0.15);
      color: $status-clean;
      border: 1px solid rgba(63, 185, 80, 0.3);
    }

    .badge-failed {
      background-color: rgba(248, 81, 73, 0.15);
      color: $severity-critical;
      border: 1px solid rgba(248, 81, 73, 0.3);
    }

    .badge-timeout {
      background-color: rgba(245, 158, 11, 0.15);
      color: $severity-medium;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .badge-cancelled {
      background-color: $bg-surface-3;
      color: $text-muted;
      border: 1px solid $border-subtle;
    }

    .badge-not-run {
      background-color: $bg-surface-3;
      color: $text-muted;
      border: 1px solid $border-subtle;
    }

    .badge-queued {
      background-color: $bg-surface-3;
      color: $text-secondary;
    }

    .run-warning {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background-color: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 4px;
      font-size: 11px;
      color: $severity-medium;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReviewerRunCardComponent {
  @Input({ required: true }) run!: ReviewerRun;

  get isVerifier(): boolean {
    return (this.run as any).role === 'verifier';
  }

  get isVerifierNotRun(): boolean {
    const r = this.run as any;
    return (
      r.state === 'cancelled' &&
      (r.attempts === 0 || r.role === 'verifier' || r.warning === 'Not run because the review failed.')
    );
  }

  get logTitle(): string {
    const typeLabel = this.isVerifier ? 'Verifier' : 'Reviewer';
    return `Sanitized ${typeLabel} Log (${this.run.selection.model})`;
  }

  get logContent(): string {
    if (this.isVerifierNotRun) {
      return 'Not run';
    }
    const r = this.run as any;
    if (r.sanitizedLog) {
      return r.sanitizedLog;
    }
    if (this.run.warning) {
      return this.run.warning;
    }
    return 'No process output captured.';
  }
}
