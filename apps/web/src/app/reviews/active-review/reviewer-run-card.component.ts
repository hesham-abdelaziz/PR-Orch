import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReviewJob } from '@pr-orchestrator/contracts';
import { SanitizedLogComponent } from './sanitized-log.component';
import {
  RunActivityLogComponent,
  formatActivityAction,
  formatActivityTarget,
  formatDuration,
} from './run-activity-log.component';
import { ActiveReviewStore } from './active-review.store';

export type ReviewerRun = ReviewJob['reviewers'][number] & {
  attempts?: number;
  role?: string;
  sanitizedLog?: string | null;
  exitCode?: number | null;
};

@Component({
  selector: 'app-reviewer-run-card',
  standalone: true,
  imports: [CommonModule, SanitizedLogComponent, RunActivityLogComponent],
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
            <span class="role-desc">{{ computedIsVerifier ? 'Main Verifier Unit' : 'Parallel Reviewer Unit' }}</span>
          </div>
        </div>

        <div class="state-container">
          @if (isVerifierNotRun) {
            <span class="badge badge-not-run font-mono">
              <span>○</span>
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
                  <span>⚠</span>
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
                  <span>○</span>
                  <span>QUEUED</span>
                </span>
              }
            }
          }
        </div>
      </div>

      <!-- Current Action & Target -->
      @if (currentActionText) {
        <div class="current-action-row">
          <span class="action-glyph">⚡</span>
          <span class="action-label">{{ currentActionText }}</span>
          @if (currentTargetText) {
            <span class="action-target font-mono">{{ currentTargetText }}</span>
          }
        </div>
      }

      <!-- Timing & Telemetry details -->
      @if (elapsedTimeText || activityAgeText || heartbeatText) {
        <div class="telemetry-row font-mono">
          @if (elapsedTimeText) {
            <span class="elapsed-badge">Elapsed {{ elapsedTimeText }}</span>
          }
          @if (activityAgeText) {
            <span class="activity-age" [class.quiet-warning]="isQuietProvider">
              {{ activityAgeText }}
            </span>
          }
          @if (heartbeatText) {
            <span class="heartbeat-text">{{ heartbeatText }}</span>
          }
        </div>
      }

      <!-- Visibility Hint -->
      @if (visibilityHint) {
        <div class="visibility-hint font-mono">
          <span class="visibility-glyph">ℹ</span>
          <span>{{ visibilityHint }}</span>
        </div>
      }

      <!-- Warning banner if any -->
      @if (run.warning) {
        <div class="run-warning" role="alert">
          <span class="warning-glyph">⚠</span>
          <span class="warning-msg">{{ run.warning }}</span>
        </div>
      }

      <!-- Expandable timestamped activity log -->
      @if (!isVerifierNotRun && run.activity && run.activity.recent && run.activity.recent.length > 0) {
        <app-run-activity-log
          [items]="run.activity.recent"
          [total]="run.activity.total"
          [title]="activityLogTitle"
          [isVerifierNotRun]="isVerifierNotRun"
          (expand)="onExpandActivityLog()"
        />
      }

      <!-- Collapsed sanitized CLI log for backward compatibility -->
      <app-sanitized-log
        [title]="sanitizedLogTitle"
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

    .current-action-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 4px;
      font-size: 12px;
      color: $text-primary;
    }

    .action-glyph {
      font-size: 11px;
      color: $accent-primary;
    }

    .action-label {
      font-weight: 500;
    }

    .action-target {
      color: $accent-primary;
      font-size: 11px;
      word-break: break-all;
    }

    .telemetry-row {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 11px;
      flex-wrap: wrap;
    }

    .elapsed-badge {
      color: $text-secondary;
    }

    .activity-age {
      color: $text-secondary;

      &.quiet-warning {
        color: $text-muted;
        font-style: italic;
      }
    }

    .heartbeat-text {
      color: $text-muted;
      font-size: 10px;
    }

    .visibility-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: $text-muted;
      padding: 2px 0;
    }

    .visibility-glyph {
      font-size: 11px;
      color: $text-muted;
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
  @Input() isVerifier = false;

  readonly store = inject(ActiveReviewStore, { optional: true });

  get now(): number {
    return this.store?.now ? this.store.now() : Date.now();
  }

  get computedIsVerifier(): boolean {
    return this.isVerifier || (this.run as any).role === 'verifier';
  }

  get isVerifierNotRun(): boolean {
    return (
      this.computedIsVerifier &&
      this.run.state === 'cancelled' &&
      this.run.startedAt === null &&
      (this.run.activity?.total ?? 0) === 0
    );
  }

  get currentActionText(): string | null {
    if (this.isVerifierNotRun) return null;
    const current = this.run.activity?.current;
    if (!current) return null;
    return formatActivityAction(current);
  }

  get currentTargetText(): string | null {
    if (this.isVerifierNotRun) return null;
    const current = this.run.activity?.current;
    if (!current?.target) return null;
    return formatActivityTarget(current.target);
  }

  get elapsedTimeText(): string | null {
    if (this.isVerifierNotRun || !this.run.startedAt) return null;
    const startedMs = Date.parse(this.run.startedAt);
    if (isNaN(startedMs)) return null;

    if (this.run.state === 'running') {
      const ms = Math.max(0, this.now - startedMs);
      return formatDuration(ms);
    }

    if (this.run.completedAt) {
      const completedMs = Date.parse(this.run.completedAt);
      if (!isNaN(completedMs)) {
        return formatDuration(Math.max(0, completedMs - startedMs));
      }
    }
    return null;
  }

  get isQuietProvider(): boolean {
    const act = this.run.activity;
    if (!act || !act.lastActivityAt || this.run.state !== 'running') return false;
    const ageMs = Math.max(0, this.now - Date.parse(act.lastActivityAt));
    return ageMs > 30_000;
  }

  get activityAgeText(): string | null {
    const act = this.run.activity;
    if (!act || !act.lastActivityAt) return null;

    if (this.run.state === 'running') {
      const ageMs = Math.max(0, this.now - Date.parse(act.lastActivityAt));
      if (ageMs > 30_000) {
        return `No activity update for ${formatDuration(ageMs)}`;
      }
      return `Last activity ${formatDuration(ageMs)} ago`;
    }

    return null;
  }

  get heartbeatText(): string | null {
    if (this.run.state !== 'running') return null;
    const hb = this.run.activity?.lastHeartbeatAt;
    if (!hb) return null;
    const hbAgeMs = Math.max(0, this.now - Date.parse(hb));
    return `Process alive · checked ${formatDuration(hbAgeMs)} ago`;
  }

  get visibilityHint(): string | null {
    if (this.isVerifierNotRun) return null;
    const vis = this.run.activity?.visibility;
    if (vis === 'partial') {
      return 'Limited visibility: commands only, no file details';
    }
    if (vis === 'heartbeat_only') {
      return 'Limited visibility: liveness only';
    }
    const isFinished = !['running', 'queued', 'pending'].includes(this.run.state);
    const total = this.run.activity?.total ?? 0;
    if (isFinished && (vis === null || vis === undefined) && total === 0) {
      return 'No activity recorded';
    }
    return null;
  }

  get activityLogTitle(): string {
    const typeLabel = this.computedIsVerifier ? 'Verifier' : 'Reviewer';
    return `${typeLabel} Live Activity (${this.run.selection.model})`;
  }

  get sanitizedLogTitle(): string {
    const typeLabel = this.computedIsVerifier ? 'Verifier' : 'Reviewer';
    return `Sanitized ${typeLabel} Log (${this.run.selection.model})`;
  }

  get logTitle(): string {
    return this.sanitizedLogTitle;
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

  onExpandActivityLog(): void {
    if (this.store) {
      this.store.loadRunActivity(this.run.id);
    }
  }
}
