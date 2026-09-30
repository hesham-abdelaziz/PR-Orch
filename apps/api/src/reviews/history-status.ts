import type { ReviewJobRecord } from './entities/review-job.entity.js';
import { isTerminal } from './job-state-machine.js';
import type { HistoryStatus } from './review-repository.js';

/** Status shown in history: completed jobs with warnings are flagged separately. */
export function historyStatusOf(job: ReviewJobRecord): HistoryStatus {
  if (!isTerminal(job.state)) return 'active';
  if (job.state === 'completed') {
    return job.warnings.length > 0 ? 'completed_with_warnings' : 'completed';
  }

  return job.state === 'failed' ? 'failed' : 'cancelled';
}
