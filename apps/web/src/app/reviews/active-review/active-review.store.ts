import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  JobState,
  ReviewEvent,
  ReviewJob,
  ReviewJobSchema,
  RunState,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReviewEventsService } from '../../core/api/review-events.service';

export type StageKey =
  | 'validate'
  | 'checkout'
  | 'detect'
  | 'standards'
  | 'reviewers'
  | 'verify'
  | 'report'
  | 'cleanup';

export type StageStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'not_run'
  | 'skipped'
  | 'unknown';

export interface StageInfo {
  key: StageKey;
  step: string;
  name: string;
  desc: string;
  status: StageStatus;
}

export const STAGE_KEYS: StageKey[] = [
  'validate',
  'checkout',
  'detect',
  'standards',
  'reviewers',
  'verify',
  'report',
  'cleanup',
];

export interface FailureDiagnostics {
  stage: string;
  reason: string;
}

export function parseFailedWarning(warnings: string[]): FailureDiagnostics | null {
  for (let i = warnings.length - 1; i >= 0; i--) {
    const w = warnings[i];
    const match = w.match(/^Failed during (\w+):\s*([\s\S]*)$/i);
    if (match) {
      return { stage: match[1].toLowerCase(), reason: match[2].trim() };
    }
  }
  return null;
}

export function mapBackendStageToStageKey(stage: string, reason: string): StageKey {
  switch (stage) {
    case 'preparing':
      if (/workspace layout/i.test(reason)) {
        return 'detect';
      }
      if (/standards/i.test(reason)) {
        return 'standards';
      }
      return 'checkout';
    case 'reviewing':
      return 'reviewers';
    case 'verifying':
      return 'verify';
    case 'rendering':
      return 'report';
    case 'queued':
      return 'validate';
    default:
      return 'checkout';
  }
}

export function calculateStageStatuses(job: ReviewJob | null, warnings: string[] = []): StageInfo[] {
  const state = job?.state ?? 'queued';
  const allWarnings = warnings.length > 0 ? warnings : (job?.warnings ?? []);

  const allReviewersFailed = (): boolean => {
    const reviewers = job?.reviewers;
    if (!reviewers || reviewers.length === 0) return false;
    return reviewers.every((r) => r.state === 'failed' || r.state === 'timed_out');
  };

  const getStatus = (target: StageKey): StageStatus => {
    if (state === 'completed') {
      return 'completed';
    }

    // Cleanup is always completed once the job is terminal (the backend always cleans up in finally)
    if (target === 'cleanup') {
      if (state === 'failed' || state === 'cancelled') {
        return 'completed';
      }
      return 'pending';
    }

    // Failed jobs
    if (state === 'failed') {
      const diag =
        parseFailedWarning(allWarnings) ??
        ((job as any)?.failedStage
          ? { stage: String((job as any).failedStage).toLowerCase(), reason: String((job as any).failureReason ?? '') }
          : null);

      if (diag) {
        const failedStageKey = mapBackendStageToStageKey(diag.stage, diag.reason);
        const failedIndex = STAGE_KEYS.indexOf(failedStageKey);
        const targetIndex = STAGE_KEYS.indexOf(target);

        if (targetIndex < failedIndex) {
          return 'completed';
        }
        if (targetIndex === failedIndex) {
          return 'failed';
        }
        return 'not_run';
      }

      // If no Failed during warning exists (older jobs), fall back to marking only REVIEWERS failed
      // when every reviewer run failed. Otherwise show unknown. Never show all stages failed.
      if (allReviewersFailed()) {
        const reviewersIndex = STAGE_KEYS.indexOf('reviewers');
        const targetIndex = STAGE_KEYS.indexOf(target);

        if (targetIndex < reviewersIndex) {
          return 'completed';
        }
        if (targetIndex === reviewersIndex) {
          return 'failed';
        }
        return 'not_run';
      }

      return 'unknown';
    }

    // Cancelled jobs
    if (state === 'cancelled') {
      let inProgressStage: StageKey = 'reviewers';

      for (let i = allWarnings.length - 1; i >= 0; i--) {
        const match = allWarnings[i].match(/(?:Cancelled|Failed) during (\w+)(?::\s*([\s\S]*))?/i);
        if (match) {
          inProgressStage = mapBackendStageToStageKey(match[1].toLowerCase(), match[2] ?? '');
          break;
        }
      }

      if (!allWarnings.some((w) => /(?:Cancelled|Failed) during/i.test(w))) {
        const reviewers = job?.reviewers ?? [];
        if (reviewers.length > 0 && reviewers.every((r) => r.state === 'completed')) {
          inProgressStage = 'verify';
        } else if (reviewers.length > 0) {
          inProgressStage = 'reviewers';
        } else {
          inProgressStage = 'checkout';
        }
      }

      const cancelIndex = STAGE_KEYS.indexOf(inProgressStage);
      const targetIndex = STAGE_KEYS.indexOf(target);

      if (targetIndex < cancelIndex) {
        return 'completed';
      }
      if (targetIndex === cancelIndex) {
        return 'cancelled';
      }
      return 'not_run';
    }

    switch (target) {
      case 'validate':
        return state === 'queued' ? 'running' : 'completed';
      case 'checkout':
        if (state === 'queued') return 'pending';
        if (state === 'preparing') return 'running';
        return 'completed';
      case 'detect':
        if (state === 'queued' || state === 'preparing') return state === 'preparing' ? 'running' : 'pending';
        return 'completed';
      case 'standards':
        if (state === 'queued' || state === 'preparing') return state === 'preparing' ? 'running' : 'pending';
        return 'completed';
      case 'reviewers':
        if (['queued', 'preparing'].includes(state)) return 'pending';
        if (state === 'reviewing' || state === 'cancelling') return 'running';
        return 'completed';
      case 'verify':
        if (['queued', 'preparing', 'reviewing', 'cancelling'].includes(state)) return 'pending';
        if (state === 'verifying') return 'running';
        return 'completed';
      case 'report':
        if (['queued', 'preparing', 'reviewing', 'verifying', 'cancelling'].includes(state)) return 'pending';
        if (state === 'rendering') return 'running';
        return 'completed';
      default:
        return 'pending';
    }
  };

  return [
    { key: 'validate', step: '01', name: 'VALIDATE', desc: 'Azure PR Metadata', status: getStatus('validate') },
    { key: 'checkout', step: '02', name: 'CHECKOUT', desc: 'Isolated Sandbox', status: getStatus('checkout') },
    { key: 'detect', step: '03', name: 'DETECT', desc: 'Repo Frameworks', status: getStatus('detect') },
    { key: 'standards', step: '04', name: 'STANDARDS', desc: 'Load Security Rules', status: getStatus('standards') },
    { key: 'reviewers', step: '05', name: 'REVIEWERS', desc: 'Parallel Models', status: getStatus('reviewers') },
    { key: 'verify', step: '06', name: 'VERIFY', desc: 'Main Synthesis', status: getStatus('verify') },
    { key: 'report', step: '07', name: 'REPORT', desc: 'Render Markdown', status: getStatus('report') },
    { key: 'cleanup', step: '08', name: 'CLEANUP', desc: 'Temp Workspace Purge', status: getStatus('cleanup') },
  ];
}

@Injectable({
  providedIn: 'root',
})
export class ActiveReviewStore {
  private readonly apiClient = inject(ApiClientService);
  private readonly eventsService = inject(ReviewEventsService);

  readonly job = signal<ReviewJob | null>(null);
  readonly loading = signal<boolean>(true);
  readonly cancelling = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);

  private eventSubscription: Subscription | null = null;

  readonly isTerminal = computed(() => {
    const s = this.job()?.state;
    return s === 'completed' || s === 'failed' || s === 'cancelled';
  });

  readonly canCancel = computed(() => {
    const j = this.job();
    if (!j) return false;
    if (this.isTerminal() || j.state === 'cancelling' || this.cancelling()) {
      return false;
    }
    return true;
  });

  readonly allReviewersFailed = computed(() => {
    const reviewers = this.job()?.reviewers;
    if (!reviewers || reviewers.length === 0) return false;
    return reviewers.every((r) => r.state === 'failed' || r.state === 'timed_out');
  });

  readonly hasPartialReviewerFailure = computed(() => {
    const reviewers = this.job()?.reviewers;
    if (!reviewers || reviewers.length === 0) return false;
    const hasFailed = reviewers.some((r) => r.state === 'failed' || r.state === 'timed_out');
    const hasCompleted = reviewers.some((r) => r.state === 'completed');
    return hasFailed && hasCompleted;
  });

  readonly failureWarning = computed<string | null>(() => {
    const ws = this.warnings();
    for (let i = ws.length - 1; i >= 0; i--) {
      if (/^Failed during/i.test(ws[i])) {
        return ws[i];
      }
    }
    return null;
  });

  readonly displayWarnings = computed<string[]>(() => {
    const failMsg = this.failureWarning();
    if (!failMsg) return this.warnings();
    return this.warnings().filter((w) => w !== failMsg);
  });

  readonly stageStatuses = computed<StageInfo[]>(() => {
    return calculateStageStatuses(this.job(), this.warnings());
  });

  async loadJob(reviewId?: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    const path = reviewId ? `/api/reviews/${reviewId}` : '/api/reviews/active';

    try {
      const data = await this.apiClient.request({
        method: 'GET',
        path,
        schema: ReviewJobSchema.nullable(),
      });

      if (!data) {
        this.job.set(null);
        return;
      }

      this.job.set(data);
      this.warnings.set([...data.warnings]);

      // Connect to SSE stream if not terminal
      if (!['completed', 'failed', 'cancelled'].includes(data.state)) {
        this.subscribeToEvents(data.id);
      }
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load review');
    } finally {
      this.loading.set(false);
    }
  }

  private subscribeToEvents(reviewId: string): void {
    if (this.eventSubscription) {
      this.eventSubscription.unsubscribe();
    }

    this.eventSubscription = this.eventsService.connect(reviewId).subscribe({
      next: (event: ReviewEvent) => {
        this.applyEvent(event);
      },
      error: () => {
        // SSE service handles reconnection automatically
      },
    });
  }

  applyEvent(event: ReviewEvent): void {
    switch (event.type) {
      case 'job.snapshot':
        this.job.set(event.payload.job);
        this.warnings.set([...event.payload.job.warnings]);
        break;

      case 'job.state_changed':
        this.job.update((current) => {
          if (!current) return null;
          return {
            ...current,
            state: event.payload.state,
          };
        });
        if (['completed', 'failed', 'cancelled'].includes(event.payload.state)) {
          this.cancelling.set(false);
        }
        break;

      case 'reviewer.state_changed':
        this.job.update((current) => {
          if (!current) return null;
          const updatedReviewers = current.reviewers.map((r) => {
            if (r.id === event.payload.runId) {
              return {
                ...r,
                state: event.payload.state as RunState,
              };
            }
            return r;
          });
          return {
            ...current,
            reviewers: updatedReviewers,
          };
        });
        break;

      case 'job.warning':
        this.warnings.update((list) => [...list, event.payload.message]);
        break;
    }
  }

  async cancelReview(): Promise<void> {
    const currentJob = this.job();
    if (!currentJob || !this.canCancel()) return;

    this.cancelling.set(true);

    try {
      await this.apiClient.request({
        method: 'POST',
        path: `/api/reviews/${currentJob.id}/cancel`,
        schema: ReviewJobSchema,
      });
    } catch (err: unknown) {
      this.cancelling.set(false);
      this.error.set(err instanceof Error ? err.message : 'Failed to cancel review');
    }
  }

  disconnect(): void {
    if (this.eventSubscription) {
      this.eventSubscription.unsubscribe();
      this.eventSubscription = null;
    }
    this.eventsService.disconnect();
  }
}
