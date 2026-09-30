import { Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="dialog-backdrop" (click)="onBackdropClick($event)">
      <div
        #dialogBox
        class="dialog-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        tabindex="-1"
      >
        <div class="dialog-header">
          <h2 id="confirm-dialog-title" class="dialog-title font-mono" [class.text-danger]="isDanger">
            {{ title }}
          </h2>
        </div>

        <div class="dialog-body">
          <p id="confirm-dialog-desc" class="dialog-desc">
            {{ description }}
          </p>
        </div>

        <div class="dialog-actions font-mono">
          <button
            #cancelBtn
            type="button"
            class="btn btn-secondary"
            (click)="cancel.emit()"
          >
            {{ cancelText }}
          </button>
          <button
            type="button"
            class="btn"
            [class.btn-danger]="isDanger"
            [class.btn-primary]="!isDanger"
            (click)="confirm.emit()"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    @use '../../styles/tokens' as *;
    @use '../../styles/mixins' as *;

    .dialog-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: rgba(0, 0, 0, 0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      backdrop-filter: blur(2px);
    }

    .dialog-box {
      @include card-surface;
      width: 100%;
      max-width: 440px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
      border: 1px solid $border-subtle;

      &:focus {
        outline: none;
      }
    }

    .dialog-title {
      font-size: 14px;
      font-weight: 700;
      color: $text-primary;
      margin: 0;

      &.text-danger {
        color: $severity-critical;
      }
    }

    .dialog-desc {
      font-size: 13px;
      line-height: 1.5;
      color: $text-secondary;
      margin: 0;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 8px;
    }

    .btn {
      font-size: 11px;
      padding: 8px 14px;
      cursor: pointer;
      border-radius: 6px;
      border: 1px solid transparent;
      transition: background-color 0.15s ease;

      &.btn-primary {
        background-color: $accent-primary;
        color: #002b3d;
        font-weight: 600;

        &:hover {
          background-color: $accent-primary-hover;
        }
      }

      &.btn-secondary {
        background-color: $bg-surface-3;
        color: $text-primary;
        border-color: $border-default;

        &:hover {
          background-color: #3c434c;
        }
      }

      &.btn-danger {
        background-color: $severity-critical;
        color: #fff;
        border: 1px solid rgba(248, 81, 73, 0.5);
        border-radius: 6px;

        &:hover {
          background-color: #e5534b;
        }

        &:focus-visible {
          outline: 1px solid #fff;
        }
      }
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ConfirmDialogComponent implements OnInit, OnDestroy {
  @Input() title = 'Confirm Action';
  @Input() description = 'Are you sure you want to proceed?';
  @Input() confirmText = 'Confirm';
  @Input() cancelText = 'Cancel';
  @Input() isDanger = false;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('dialogBox') dialogBox?: ElementRef<HTMLElement>;
  @ViewChild('cancelBtn') cancelBtn?: ElementRef<HTMLButtonElement>;

  private previouslyFocusedElement: HTMLElement | null = null;

  ngOnInit(): void {
    if (typeof document !== 'undefined') {
      this.previouslyFocusedElement = document.activeElement as HTMLElement;
      setTimeout(() => {
        this.cancelBtn?.nativeElement.focus();
      }, 0);
    }
  }

  ngOnDestroy(): void {
    if (this.previouslyFocusedElement && typeof this.previouslyFocusedElement.focus === 'function') {
      this.previouslyFocusedElement.focus();
    }
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    this.cancel.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialog-backdrop')) {
      this.cancel.emit();
    }
  }
}
