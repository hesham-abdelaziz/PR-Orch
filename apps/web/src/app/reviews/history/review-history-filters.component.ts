import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-review-history-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="filters-card">
      <div class="filter-group search-group">
        <label for="search-input" class="filter-label font-mono">SEARCH</label>
        <div class="input-wrapper">
          <span class="search-icon">🔍</span>
          <input
            id="search-input"
            type="text"
            class="form-control font-mono"
            placeholder="Filter by title, repo, PR ID, or author..."
            [ngModel]="searchTerm"
            (ngModelChange)="searchTermChange.emit($event)"
          />
        </div>
      </div>

      <div class="filter-group select-group">
        <label for="status-filter" class="filter-label font-mono">STATUS</label>
        <select
          id="status-filter"
          class="form-select font-mono"
          [ngModel]="statusFilter"
          (ngModelChange)="statusFilterChange.emit($event)"
        >
          <option value="all">All States</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .filters-card {
      @include card-surface;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;

      @media (min-width: 640px) {
        flex-direction: row;
        align-items: flex-end;
      }
    }

    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .search-group {
      flex: 1;
    }

    .select-group {
      width: 180px;
    }

    .filter-label {
      font-size: 10px;
      color: $text-muted;
      letter-spacing: 0.05em;
    }

    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 12px;
      color: $text-muted;
      pointer-events: none;
    }

    .form-control {
      padding-left: 32px;
      width: 100%;
      font-size: 12px;
      color: $text-primary;
      background-color: $bg-surface-1;
      border: 1px solid $border-default;
      border-radius: 6px;
      padding-top: 8px;
      padding-bottom: 8px;
      padding-right: 12px;

      &:focus-visible {
        outline: 1px solid $accent-primary;
      }
    }

    .form-select {
      cursor: pointer;
      font-size: 12px;
      color: $text-primary;
      background-color: $bg-surface-1;
      border: 1px solid $border-default;
      border-radius: 6px;
      padding: 8px 12px;

      &:focus-visible {
        outline: 1px solid $accent-primary;
      }

      option {
        background-color: $bg-surface-2;
        color: $text-primary;
      }
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReviewHistoryFiltersComponent {
  @Input() searchTerm = '';
  @Output() searchTermChange = new EventEmitter<string>();

  @Input() statusFilter = 'all';
  @Output() statusFilterChange = new EventEmitter<string>();
}
