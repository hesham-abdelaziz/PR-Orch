import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  ActivityVisibility,
  JobState,
  RUN_ACTIVITY_RETAINED_PER_RUN,
  ReviewEvent,
  ReviewJob,
  ReviewJobSchema,
  RunActivity,
  RunActivityLogSchema,
  RunState,
} from '@pr-orchestrator/contracts';
import { ApiClientService } from '../../core/api/api-client.service';
import { ReviewEventsService } from '../../core/api/review-events.service';

export type ReviewerRun = ReviewJob['reviewers'][number];

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

      if (allReviewersFailed()) {
        const failedIndex = STAGE_KEYS.indexOf('reviewers');
        const targetIndex = STAGE_KEYS.indexOf(target);
        if (targetIndex < failedIndex) {
          return 'completed';
        }
        if (targetIndex === failedIndex) {
          return 'failed';
        }
        return 'not_run';
      }

      return 'unknown';
    }

    // Cancelled jobs
    if (state === 'cancelled') {
      let inProgressStage: StageKey = 'reviewers';
      const reviewers = job?.reviewers ?? [];

      if ((job as any)?.inProgressStage) {
        inProgressStage = mapBackendStageToStageKey(String((job as any).inProgressStage), '');
      } else {
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

function updateRunState(
  run: ReviewerRun,
  payload: {
    state: RunState;
    startedAt?: string | null;
    completedAt?: string | null;
  },
): ReviewerRun {
  const isLeavingRunning = payload.state !== 'running';
  return {
    ...run,
    state: payload.state,
    startedAt: payload.startedAt !== undefined ? payload.startedAt : run.startedAt,
    completedAt: payload.completedAt !== undefined ? payload.completedAt : run.completedAt,
    activity: run.activity
      ? {
          ...run.activity,
          lastHeartbeatAt: isLeavingRunning ? null : run.activity.lastHeartbeatAt,
        }
      : undefined,
  };
}

function applyActivityToRun(
  run: ReviewerRun,
  payload: {
    activity: RunActivity;
    visibility: ActivityVisibility | null;
    total: number;
    lastActivityAt: string | null;
  },
): ReviewerRun {
  const existingSummary = run.activity;
  const existingRecent = existingSummary?.recent ?? [];

  const exists = existingRecent.some((entry) => entry.id === payload.activity.id);
  const updatedRecent = exists
    ? existingRecent
    : [...existingRecent, payload.activity]
        .sort((a, b) => a.seq - b.seq)
        .slice(-RUN_ACTIVITY_RETAINED_PER_RUN);

  const updatedCurrent =
    payload.activity.kind === 'provider' && payload.activity.seq > (existingSummary?.current?.seq ?? 0)
      ? payload.activity
      : existingSummary?.current ?? null;

  return {
    ...run,
    activity: {
      visibility: payload.visibility,
      recent: updatedRecent,
      current: updatedCurrent,
      lastActivityAt: [payload.lastActivityAt, existingSummary?.lastActivityAt].filter((at): at is string => !!at).sort().at(-1) ?? null,
      lastHeartbeatAt: existingSummary?.lastHeartbeatAt ?? null,
      total: Math.max(payload.total, existingSummary?.total ?? 0, updatedRecent.length),
    },
  };
}

function applyHeartbeatToRun(run: ReviewerRun, at: string): ReviewerRun {
  if (!run.activity) {
    return {
      ...run,
      activity: {
        visibility: null,
        recent: [],
        current: null,
        lastActivityAt: null,
        lastHeartbeatAt: at,
        total: 0,
      },
    };
  }
  return {
    ...run,
    activity: {
      ...run.activity,
      lastHeartbeatAt: at,
    },
  };
}

@Injectable({
  providedIn: 'root',
})
export class ActiveReviewStore implements OnDestroy {
  private readonly apiClient = inject(ApiClientService);
  private readonly eventsService = inject(ReviewEventsService);

  readonly job = signal<ReviewJob | null>(null);
  readonly loading = signal<boolean>(true);
  readonly cancelling = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);
  readonly now = signal<number>(Date.now());

  private eventSubscription: Subscription | null = null;
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private activityRequests = new Set<string>();
  private activitySnapshotVersion = 0;

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

  startTicker(): void {
    if (!this.tickerInterval) {
      this.now.set(Date.now());
      this.tickerInterval = setInterval(() => {
        this.now.set(Date.now());
      }, 1000);
    }
  }

  stopTicker(): void {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
  }

  replaceSnapshot(job: ReviewJob): void {
    this.activityRequests.clear();
    this.activitySnapshotVersion++;
    this.job.set(job);
    this.warnings.set([...job.warnings]);
  }

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

      this.replaceSnapshot(data);
      this.startTicker();

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

  async loadRunActivity(runId: string): Promise<void> {
    const currentJob = this.job();
    if (!currentJob) return;
    const key = `${currentJob.id}:${runId}`;
    if (this.activityRequests.has(key)) return;
    this.activityRequests.add(key);
    const version = this.activitySnapshotVersion;

    try {
      const data = await this.apiClient.request({
        method: 'GET',
        path: `/api/reviews/${currentJob.id}/runs/${runId}/activity`,
        schema: RunActivityLogSchema,
      });
      if (version !== this.activitySnapshotVersion || this.job()?.id !== currentJob.id) return;

      this.job.update((job) => {
        if (!job) return null;

        const mergeIntoRun = (run: ReviewerRun): ReviewerRun => {
          if (run.id !== runId) return run;

          const existing = run.activity?.recent ?? [];
          const map = new Map<string, RunActivity>();
          for (const item of existing) map.set(item.id, item);
          for (const item of data.items) map.set(item.id, item);

          const mergedRecent = Array.from(map.values())
            .sort((a, b) => a.seq - b.seq)
            .slice(-RUN_ACTIVITY_RETAINED_PER_RUN);

          const currentProvider =
            [...mergedRecent].reverse().find((e) => e.kind === 'provider') ??
            run.activity?.current ??
            null;

          return {
            ...run,
            activity: {
              visibility: run.activity?.visibility ?? null,
              recent: mergedRecent,
              current: currentProvider,
              lastActivityAt: run.activity?.lastActivityAt ?? currentProvider?.at ?? null,
              lastHeartbeatAt: run.activity?.lastHeartbeatAt ?? null,
              total: Math.max(data.total, run.activity?.total ?? 0, mergedRecent.length),
            },
          };
        };

        return {
          ...job,
          reviewers: job.reviewers.map(mergeIntoRun),
          verifier: job.verifier ? mergeIntoRun(job.verifier) : undefined,
        };
      });
    } catch (err: unknown) {
      if (version === this.activitySnapshotVersion) this.activityRequests.delete(key);
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
        this.replaceSnapshot(event.payload.job);
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

          const isVerifierMatch = current.verifier && current.verifier.id === event.payload.runId;
          const updatedVerifier = isVerifierMatch
            ? updateRunState(current.verifier!, event.payload)
            : current.verifier;

          const updatedReviewers = current.reviewers.map((r) => {
            if (r.id === event.payload.runId) {
              return updateRunState(r, event.payload);
            }
            return r;
          });

          return {
            ...current,
            reviewers: updatedReviewers,
            verifier: updatedVerifier,
          };
        });
        break;

      case 'run.activity':
        this.job.update((current) => {
          if (!current) return null;

          const isVerifierMatch = current.verifier && current.verifier.id === event.payload.runId;
          const updatedVerifier = isVerifierMatch
            ? applyActivityToRun(current.verifier!, event.payload)
            : current.verifier;

          const updatedReviewers = current.reviewers.map((r) => {
            if (r.id === event.payload.runId) {
              return applyActivityToRun(r, event.payload);
            }
            return r;
          });

          return {
            ...current,
            reviewers: updatedReviewers,
            verifier: updatedVerifier,
          };
        });
        break;

      case 'run.heartbeat':
        this.job.update((current) => {
          if (!current) return null;

          const isVerifierMatch = current.verifier && current.verifier.id === event.payload.runId;
          const updatedVerifier = isVerifierMatch
            ? applyHeartbeatToRun(current.verifier!, event.payload.at)
            : current.verifier;

          const updatedReviewers = current.reviewers.map((r) => {
            if (r.id === event.payload.runId) {
              return applyHeartbeatToRun(r, event.payload.at);
            }
            return r;
          });

          return {
            ...current,
            reviewers: updatedReviewers,
            verifier: updatedVerifier,
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
    this.stopTicker();
    if (this.eventSubscription) {
      this.eventSubscription.unsubscribe();
      this.eventSubscription = null;
    }
    this.eventsService.disconnect();
  }

  ngOnDestroy(): void {
    this.disconnect();
  }
}
