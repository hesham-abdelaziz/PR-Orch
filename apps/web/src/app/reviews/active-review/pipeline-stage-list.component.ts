import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StageInfo } from './active-review.store';

@Component({
  selector: 'app-pipeline-stage-list',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="stages-container">
      <div class="stages-header">
        <span class="header-title font-mono">PIPELINE EXECUTION DAG</span>
        <span class="header-desc font-mono">8 Deterministic Stages</span>
      </div>

      <div class="stages-grid">
        @for (stage of stages; track stage.key) {
          <div class="stage-item" [class]="'status-' + stage.status">
            <div class="stage-top">
              <span class="stage-step font-mono">{{ stage.step }}. {{ stage.name }}</span>
              <span class="status-indicator">
                @switch (stage.status) {
                  @case ('completed') {
                    <span class="status-glyph completed">✓</span>
                  }
                  @case ('running') {
                    <span class="status-glyph running">▶</span>
                  }
                  @case ('failed') {
                    <span class="status-glyph failed">✕</span>
                  }
                  @case ('cancelled') {
                    <span class="status-glyph cancelled">⊘</span>
                  }
                  @case ('not_run') {
                    <span class="status-glyph not-run">⊘</span>
                  }
                  @case ('skipped') {
                    <span class="status-glyph skipped">⊘</span>
                  }
                  @case ('unknown') {
                    <span class="status-glyph unknown">?</span>
                  }
                  @default {
                    <span class="status-glyph pending">⋯</span>
                  }
                }
              </span>
            </div>
            <div class="stage-desc truncate" [title]="stage.desc">{{ stage.desc }}</div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .stages-container {
      @include card-surface;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .stages-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid $border-subtle;
    }

    .header-title {
      font-size: 11px;
      font-weight: 600;
      color: $text-secondary;
      letter-spacing: 0.04em;
    }

    .header-desc {
      font-size: 11px;
      color: $text-muted;
    }

    .stages-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;

      @media (min-width: 768px) {
        grid-template-columns: repeat(4, 1fr);
      }

      @media (min-width: 1200px) {
        grid-template-columns: repeat(8, 1fr);
      }
    }

    .stage-item {
      background-color: $bg-surface-1;
      border: 1px solid $border-subtle;
      border-radius: 6px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: all 0.15s ease;

      &.status-running {
        background-color: rgba(56, 189, 248, 0.08);
        border-color: rgba(56, 189, 248, 0.4);
      }

      &.status-completed {
        border-color: rgba(63, 185, 80, 0.3);
      }

      &.status-failed {
        border-color: rgba(248, 81, 73, 0.3);
      }

      &.status-not_run, &.status-skipped {
        opacity: 0.45;
        border-color: $border-subtle;
      }

      &.status-unknown {
        opacity: 0.6;
        border-color: rgba(245, 158, 11, 0.3);
      }

      &.status-pending {
        opacity: 0.6;
      }
    }

    .stage-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .stage-step {
      font-size: 10px;
      font-weight: 600;
      color: $text-primary;
    }

    .status-glyph {
      font-size: 10px;
      font-weight: bold;

      &.completed { color: $status-clean; }
      &.running { color: $accent-primary; animation: blink 1s infinite alternate; }
      &.failed { color: $severity-critical; }
      &.cancelled { color: $text-muted; }
      &.not-run, &.skipped { color: $text-muted; }
      &.unknown { color: $severity-medium; }
      &.pending { color: $text-muted; }
    }

    @keyframes blink {
      from { opacity: 0.4; }
      to { opacity: 1; }
    }

    .stage-desc {
      font-size: 11px;
      color: $text-secondary;
    }

    .truncate {
      @include truncate;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class PipelineStageListComponent {
  @Input() stages: StageInfo[] = [];
}
