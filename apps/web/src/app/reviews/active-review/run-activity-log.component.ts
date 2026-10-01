import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivityTarget, RunActivity } from '@pr-orchestrator/contracts';

export function formatActivityTarget(target?: ActivityTarget): string {
  if (!target) return '';
  if (target.startLine !== undefined && target.endLine !== undefined && target.endLine > target.startLine) {
    return `${target.path}:${target.startLine}-${target.endLine}`;
  }
  if (target.startLine !== undefined) {
    return `${target.path}:${target.startLine}`;
  }
  return target.path;
}

export function formatActivityAction(activity: RunActivity): string {
  switch (activity.action) {
    case 'reading_file':
      return 'Reading file';
    case 'searching':
      return 'Searching';
    case 'listing_files':
      return 'Listing files';
    case 'running_command':
      return 'Running a read-only command';
    case 'thinking':
      return 'Reasoning';
    case 'writing_answer':
      return 'Writing the answer';
    case 'tool_other':
      return activity.tool ? `Using a tool (${activity.tool})` : 'Using a tool';
    case 'attempt_started':
      return activity.attempt === 2 ? 'Correction attempt started' : `Attempt ${activity.attempt ?? 1} started`;
    case 'process_started':
      return 'Provider process started';
    case 'attempt_ended':
      return `Attempt ${activity.attempt ?? 1} ended: ${activity.outcome ?? 'completed'}`;
    case 'events_skipped':
      return `${activity.count ?? 0} unreadable progress events ignored`;
    default:
      return activity.action;
  }
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

export function formatLocalTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return isoString;
  }
}

@Component({
  selector: 'app-run-activity-log',
  standalone: true,
  imports: [CommonModule],
  template: `
    <details class="activity-log" [open]="isOpen" (toggle)="onToggle($event)">
      <summary class="log-summary" aria-label="Toggle activity log">
        <span class="summary-arrow" aria-hidden="true">▶</span>
        <span class="summary-title font-mono">{{ title }}</span>
        @if (hasMore) {
          <span class="log-count-hint font-mono">Showing the latest {{ items.length }} of {{ total }} events</span>
        }
      </summary>
      <div class="activity-log-body" #scrollContainer (scroll)="onScroll()">
        @if (isVerifierNotRun) {
          <div class="empty-log font-mono">Not run</div>
        } @else if (items.length === 0) {
          <div class="empty-log font-mono">No activity recorded.</div>
        } @else {
          @for (item of items; track item.id) {
            <div class="activity-row" [class]="'kind-' + item.kind">
              <span class="activity-time font-mono">{{ formatTime(item.at) }}</span>
              <span class="activity-label">{{ formatAction(item) }}</span>
              @if (item.target) {
                <span class="activity-target font-mono">{{ formatTarget(item.target) }}</span>
              }
            </div>
          }
        }
      </div>
    </details>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .activity-log {
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 4px;
      overflow: hidden;
      margin-top: 6px;

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

    .log-count-hint {
      margin-left: auto;
      font-size: 10px;
      color: $text-muted;
    }

    .activity-log-body {
      padding: 6px 10px;
      background-color: $bg-surface-1;
      max-height: 220px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .empty-log {
      font-size: 11px;
      color: $text-muted;
      font-style: italic;
      padding: 4px 0;
    }

    .activity-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      font-size: 11px;
      line-height: 1.4;
      padding: 2px 6px;
      border-radius: 3px;

      &.kind-provider {
        color: $text-primary;
      }

      &.kind-lifecycle {
        color: $text-secondary;
        border-left: 2px solid $text-muted;
        background-color: rgba(110, 118, 129, 0.08);
      }

      &.kind-notice {
        color: $severity-medium;
        border-left: 2px solid $severity-medium;
        background-color: rgba(245, 158, 11, 0.08);
      }
    }

    .activity-time {
      font-size: 10px;
      color: $text-muted;
      flex-shrink: 0;
    }

    .activity-label {
      flex-shrink: 0;
    }

    .activity-target {
      color: $accent-primary;
      word-break: break-all;
      font-size: 10px;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class RunActivityLogComponent implements AfterViewChecked {
  @Input() items: RunActivity[] = [];
  @Input() total = 0;
  @Input() title = 'Activity Log';
  @Input() isOpen = false;
  @Input() isVerifierNotRun = false;

  @Output() expand = new EventEmitter<void>();

  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLDivElement>;

  private userScrolledUp = false;
  private prevItemsLength = 0;

  get hasMore(): boolean {
    return this.total > this.items.length;
  }

  onToggle(event: Event): void {
    const details = event.target as HTMLDetailsElement;
    const wasOpen = this.isOpen;
    this.isOpen = details.open;
    if (this.isOpen && !wasOpen && this.hasMore) {
      this.expand.emit();
    }
  }

  onScroll(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 15;
    this.userScrolledUp = !isAtBottom;
  }

  ngAfterViewChecked(): void {
    if (this.isOpen && !this.userScrolledUp && this.scrollContainer && this.items.length !== this.prevItemsLength) {
      this.prevItemsLength = this.items.length;
      const el = this.scrollContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
    }
  }

  formatTime(iso: string): string {
    return formatLocalTime(iso);
  }

  formatAction(activity: RunActivity): string {
    return formatActivityAction(activity);
  }

  formatTarget(target?: ActivityTarget): string {
    return formatActivityTarget(target);
  }
}
