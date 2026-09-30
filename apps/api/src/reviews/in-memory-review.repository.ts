import { Injectable } from '@nestjs/common';

import type { ReportRecord } from '../reports/entities/report.entity.js';
import type { CandidateFindingRecord } from './entities/candidate-finding.entity.js';
import type { FinalFindingRecord } from './entities/final-finding.entity.js';
import type { JobPatch, ReviewJobRecord } from './entities/review-job.entity.js';
import type { ReviewerRunRecord } from './entities/reviewer-run.entity.js';
import { historyStatusOf } from './history-status.js';
import { isTerminal } from './job-state-machine.js';
import type {
  CompleteJobInput,
  CreateJobResult,
  HistoryPage,
  ReviewHistoryFilter,
  ReviewRepository,
  TransitionInput,
  TransitionResult,
} from './review-repository.js';

const clone = <T>(value: T): T => structuredClone(value);

export { historyStatusOf };

/**
 * Reference implementation of the persistence port, used by the engine tests
 * and as executable documentation of the atomicity the SQLite adapter must
 * provide. Single-threaded JavaScript makes each method atomic.
 */
@Injectable()
export class InMemoryReviewRepository implements ReviewRepository {
  private readonly jobs = new Map<string, ReviewJobRecord>();
  private readonly runs = new Map<string, ReviewerRunRecord>();
  private readonly candidates = new Map<string, CandidateFindingRecord>();
  private readonly finalFindings = new Map<string, FinalFindingRecord>();
  private readonly reports = new Map<string, ReportRecord>();

  createJob(record: ReviewJobRecord, initialRuns: ReviewerRunRecord[] = []): Promise<CreateJobResult> {
    const active = [...this.jobs.values()].find((job) => !isTerminal(job.state));
    if (active) return Promise.resolve({ created: false, activeJobId: active.id });

    this.jobs.set(record.id, clone(record));
    for (const run of initialRuns) this.runs.set(run.id, clone(run));

    return Promise.resolve({ created: true, job: clone(record) });
  }

  getJob(jobId: string): Promise<ReviewJobRecord | null> {
    const job = this.jobs.get(jobId);

    return Promise.resolve(job ? clone(job) : null);
  }

  getActiveJob(): Promise<ReviewJobRecord | null> {
    const active = [...this.jobs.values()].find((job) => !isTerminal(job.state));

    return Promise.resolve(active ? clone(active) : null);
  }

  listNonTerminalJobs(): Promise<ReviewJobRecord[]> {
    return Promise.resolve([...this.jobs.values()].filter((job) => !isTerminal(job.state)).map(clone));
  }

  listJobsPendingCleanup(): Promise<ReviewJobRecord[]> {
    return Promise.resolve([...this.jobs.values()].filter((job) => job.cleanupPending && isTerminal(job.state)).map(clone));
  }

  transitionJob(input: TransitionInput): Promise<TransitionResult> {
    const job = this.jobs.get(input.jobId);
    if (!job) return Promise.resolve({ applied: false, job: null });
    if (job.state !== input.expectedFrom) return Promise.resolve({ applied: false, job: clone(job) });

    return Promise.resolve({ applied: true, job: this.apply(job, input.to, input.at, input.patch) });
  }

  updateJob(jobId: string, patch: JobPatch, at: string): Promise<ReviewJobRecord | null> {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.resolve(null);

    Object.assign(job, withoutSequence(clone(patch)), { updatedAt: at });

    return Promise.resolve(clone(job));
  }

  allocateEventSequence(jobId: string): Promise<number | null> {
    const job = this.jobs.get(jobId);
    if (!job) return Promise.resolve(null);

    job.eventSequence += 1;

    return Promise.resolve(job.eventSequence);
  }

  getEventSequence(jobId: string): Promise<number | null> {
    return Promise.resolve(this.jobs.get(jobId)?.eventSequence ?? null);
  }

  saveRun(run: ReviewerRunRecord): Promise<void> {
    this.runs.set(run.id, clone(run));

    return Promise.resolve();
  }

  listRuns(jobId: string): Promise<ReviewerRunRecord[]> {
    return Promise.resolve([...this.runs.values()].filter((run) => run.jobId === jobId).map(clone));
  }

  saveCandidates(records: CandidateFindingRecord[]): Promise<void> {
    for (const record of records) this.candidates.set(`${record.jobId}:${record.id}`, clone(record));

    return Promise.resolve();
  }

  listCandidates(jobId: string): Promise<CandidateFindingRecord[]> {
    return Promise.resolve(
      [...this.candidates.values()].filter((record) => record.jobId === jobId).map(clone),
    );
  }

  completeJob(input: CompleteJobInput): Promise<TransitionResult> {
    const job = this.jobs.get(input.jobId);
    if (!job) return Promise.resolve({ applied: false, job: null });
    if (job.state !== 'rendering' || this.reports.has(input.jobId)) {
      return Promise.resolve({ applied: false, job: clone(job) });
    }

    this.reports.set(input.jobId, clone(input.report));
    for (const finalFinding of input.finalFindings) {
      this.finalFindings.set(`${input.jobId}:${finalFinding.id}`, clone(finalFinding));
    }

    return Promise.resolve({
      applied: true,
      job: this.apply(job, 'completed', input.at, input.patch),
    });
  }

  getReport(jobId: string): Promise<ReportRecord | null> {
    const report = this.reports.get(jobId);

    return Promise.resolve(report ? clone(report) : null);
  }

  queryJobs(
    filter: ReviewHistoryFilter,
    page: HistoryPage,
  ): Promise<{ items: ReviewJobRecord[]; nextCursor: string | null }> {
    const matching = [...this.jobs.values()]
      .filter((job) => this.matches(job, filter))
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? right.id.localeCompare(left.id)
          : right.createdAt.localeCompare(left.createdAt),
      );

    const after = page.cursor ? decodeCursor(page.cursor) : undefined;
    const start = after
      ? matching.findIndex((job) => job.createdAt === after.createdAt && job.id === after.id) + 1
      : 0;
    const items = matching.slice(start, start + page.limit);
    const last = items.at(-1);
    const hasMore = start + page.limit < matching.length;

    return Promise.resolve({
      items: items.map(clone),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    });
  }

  private apply(job: ReviewJobRecord, to: ReviewJobRecord['state'], at: string, patch?: JobPatch) {
    Object.assign(job, patch ? withoutSequence(clone(patch)) : {}, {
      state: to,
      updatedAt: at,
      completedAt: isTerminal(to) ? at : job.completedAt,
    });

    return clone(job);
  }

  private matches(job: ReviewJobRecord, filter: ReviewHistoryFilter): boolean {
    const repository = `${job.pullRequest.project}/${job.pullRequest.repository}`.toLowerCase();

    if (filter.repository && !repository.includes(filter.repository.toLowerCase())) return false;
    if (
      filter.provider &&
      job.main.provider !== filter.provider &&
      !job.reviewers.some((reviewer) => reviewer.provider === filter.provider)
    ) {
      return false;
    }
    if (filter.status && historyStatusOf(job) !== filter.status) return false;
    if (filter.risk && job.overallRisk !== filter.risk) return false;
    if (filter.from && job.createdAt < filter.from) return false;
    if (filter.to && job.createdAt > filter.to) return false;
    if (filter.text) {
      const haystack = `${job.pullRequest.title} ${repository}`.toLowerCase();
      if (!haystack.includes(filter.text.toLowerCase())) return false;
    }

    return true;
  }
}

/** Only `allocateEventSequence` may move the counter, so a patch can never rewind it. */
function withoutSequence(patch: JobPatch): JobPatch {
  const { eventSequence: _ignored, ...rest } = patch as JobPatch & { eventSequence?: number };

  return rest;
}

function encodeCursor(job: ReviewJobRecord): string {
  return Buffer.from(`${job.createdAt}|${job.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | undefined {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');

  return createdAt && id ? { createdAt, id } : undefined;
}
