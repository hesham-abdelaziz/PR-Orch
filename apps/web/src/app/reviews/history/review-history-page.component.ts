import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ReviewJob } from '@pr-orchestrator/contracts';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReviewHistoryFiltersComponent } from './review-history-filters.component';
import { ReviewHistoryTableComponent } from './review-history-table.component';

@Component({
  selector: 'app-review-history-page',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ReviewHistoryFiltersComponent,
    ReviewHistoryTableComponent,
  ],
  template: `
    <div class="history-page-container">
      <!-- Header -->
      <div class="page-header">
        <div class="header-titles">
          <h1 class="page-title">Review History</h1>
          <p class="page-subtitle font-mono">
            Immutable history of multi-model pull request reviews and verified findings
          </p>
        </div>

        <div class="header-actions">
          <a routerLink="/reviews/new" class="btn btn-primary font-mono">
            + New Review
          </a>
        </div>
      </div>

      <!-- Filters -->
      <app-review-history-filters
        [searchTerm]="searchTerm()"
        (searchTermChange)="searchTerm.set($event)"
        [statusFilter]="statusFilter()"
        (statusFilterChange)="statusFilter.set($event)"
      ></app-review-history-filters>

      <!-- Loading / Error States -->
      @if (loading()) {
        <div class="loading-state font-mono">
          <span class="loading-spinner"></span>
          <span>Loading review history...</span>
        </div>
      } @else if (error()) {
        <div class="error-banner">
          <span class="error-title font-mono">FAILED TO LOAD HISTORY</span>
          <p>{{ error() }}</p>
          <button class="btn btn-secondary font-mono" (click)="loadHistory()">Retry</button>
        </div>
      } @else {
        <!-- Results Table -->
        <app-review-history-table
          [jobs]="filteredJobs()"
          (rowClick)="onRowClick($event)"
        ></app-review-history-table>
      }
    </div>
  `,
  styles: [`
    @use '../../../styles/tokens' as *;
    @use '../../../styles/mixins' as *;

    .history-page-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid $border-subtle;
    }

    .header-titles {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .page-title {
      font-size: 22px;
      font-weight: 700;
      color: $text-primary;
      margin: 0;
    }

    .page-subtitle {
      font-size: 11px;
      color: $text-muted;
      margin: 0;
    }

    .btn {
      font-size: 11px;
      padding: 8px 14px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
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
    }

    .loading-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 48px;
      color: $text-muted;
      font-size: 13px;
    }

    .loading-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid $border-subtle;
      border-top-color: $accent-primary;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .error-banner {
      @include card-surface;
      border-color: rgba(248, 81, 73, 0.4);
      background-color: rgba(248, 81, 73, 0.05);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: flex-start;
    }

    .error-title {
      font-size: 12px;
      color: $severity-critical;
      font-weight: 700;
    }

    .font-mono {
      font-family: $font-mono;
    }
  `],
})
export class ReviewHistoryPageComponent implements OnInit {
  private readonly apiClient = inject(ApiClientService);
  private readonly router = inject(Router);

  jobs = signal<ReviewJob[]>([]);
  loading = signal<boolean>(false);
  error = signal<string | null>(null);

  searchTerm = signal<string>('');
  statusFilter = signal<string>('all');

  filteredJobs = computed<ReviewJob[]>(() => {
    let list = this.jobs();
    const query = this.searchTerm().trim().toLowerCase();
    const status = this.statusFilter();

    if (status !== 'all') {
      list = list.filter((j) => j.state === status);
    }

    if (query) {
      list = list.filter((j) => {
        const pr = j.pullRequest;
        return (
          pr.title.toLowerCase().includes(query) ||
          pr.repository.toLowerCase().includes(query) ||
          pr.organization.toLowerCase().includes(query) ||
          pr.author.displayName.toLowerCase().includes(query) ||
          pr.pullRequestId.toString().includes(query)
        );
      });
    }

    return list;
  });

  ngOnInit(): void {
    this.loadHistory();
  }

  async loadHistory(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const data = await this.apiClient.request<ReviewJob[]>({
        method: 'GET',
        path: '/api/reviews',
      });
      this.jobs.set(data ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error loading history';
      this.error.set(msg);
    } finally {
      this.loading.set(false);
    }
  }

  onRowClick(job: ReviewJob): void {
    this.router.navigate([`/reviews/${job.id}`]);
  }
}
