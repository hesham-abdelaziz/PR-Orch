import { Injectable, effect, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ReviewEvent, ReviewEventSchema } from '@pr-orchestrator/contracts';
import { AuthStore } from '../auth/auth.store';

@Injectable({
  providedIn: 'root',
})
export class ReviewEventsService {
  private readonly authStore = inject(AuthStore, { optional: true });

  private eventSource: EventSource | null = null;
  private eventSubject = new Subject<ReviewEvent>();
  private lastSequence = -1;
  private currentReviewId: string | null = null;
  private isTerminal = false;
  private retryAttempts = 0;
  private retryTimeout: any = null;

  constructor() {
    if (this.authStore && typeof this.authStore.isAuthenticated === 'function') {
      effect(() => {
        if (!this.authStore?.isAuthenticated()) {
          this.disconnect();
        }
      });
    }
  }

  connect(reviewId: string): Observable<ReviewEvent> {
    if (this.currentReviewId === reviewId && this.eventSource) {
      return this.eventSubject.asObservable();
    }

    this.disconnect();
    this.currentReviewId = reviewId;
    this.lastSequence = -1;
    this.isTerminal = false;
    this.retryAttempts = 0;

    this.initEventSource(reviewId);

    return this.eventSubject.asObservable();
  }

  private initEventSource(reviewId: string): void {
    if (this.isTerminal) return;

    try {
      this.eventSource = new EventSource(`/api/reviews/${reviewId}/events`, {
        withCredentials: true,
      });

      this.eventSource.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      this.eventSource.onerror = (err) => {
        this.handleError(err);
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (!event.data || typeof event.data !== 'string') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      // Discard invalid JSON silently
      return;
    }

    const validation = ReviewEventSchema.safeParse(parsed);
    if (!validation.success) {
      // Discard schema violation silently
      return;
    }

    const reviewEvent = validation.data;

    // Snapshot recovery vs monotonic sequence enforcement
    if (reviewEvent.type === 'job.snapshot') {
      this.lastSequence = reviewEvent.sequence;
    } else {
      if (reviewEvent.sequence <= this.lastSequence) {
        return;
      }
      this.lastSequence = reviewEvent.sequence;
    }
    this.retryAttempts = 0; // Successful event resets retry counter

    this.eventSubject.next(reviewEvent);

    // Check if terminal state reached
    if (
      reviewEvent.type === 'job.state_changed' &&
      ['completed', 'failed', 'cancelled'].includes(reviewEvent.payload.state)
    ) {
      this.isTerminal = true;
      this.closeEventSource();
    } else if (
      reviewEvent.type === 'job.snapshot' &&
      ['completed', 'failed', 'cancelled'].includes(reviewEvent.payload.job.state)
    ) {
      this.isTerminal = true;
      this.closeEventSource();
    }
  }

  private handleError(_err: any): void {
    if (this.isTerminal) {
      this.closeEventSource();
      return;
    }

    this.closeEventSource();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.isTerminal || !this.currentReviewId) return;

    // Bounded exponential backoff: 1s, 2s, 4s, capped at 10s
    const backoffMs = Math.min(1000 * Math.pow(2, this.retryAttempts), 10000);
    this.retryAttempts++;

    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }

    this.retryTimeout = setTimeout(() => {
      if (!this.isTerminal && this.currentReviewId) {
        this.initEventSource(this.currentReviewId);
      }
    }, backoffMs);
  }

  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  disconnect(): void {
    this.isTerminal = true;
    this.closeEventSource();
    this.currentReviewId = null;
    this.lastSequence = -1;
  }
}
