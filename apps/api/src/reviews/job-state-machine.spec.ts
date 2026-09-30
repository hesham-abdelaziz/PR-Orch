import type { JobState } from '@pr-orchestrator/contracts';
import { describe, expect, it } from 'vitest';

import { jobRecord } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';
import {
  IllegalTransitionError,
  JobStateMachine,
  canTransition,
  isTerminal,
} from './job-state-machine.js';

const STATES: JobState[] = [
  'queued',
  'preparing',
  'reviewing',
  'verifying',
  'rendering',
  'completed',
  'failed',
  'cancelling',
  'cancelled',
];

const LEGAL: Record<JobState, JobState[]> = {
  queued: ['preparing', 'failed', 'cancelling'],
  preparing: ['reviewing', 'failed', 'cancelling'],
  reviewing: ['verifying', 'failed', 'cancelling'],
  verifying: ['rendering', 'failed', 'cancelling'],
  rendering: ['completed', 'failed', 'cancelling'],
  cancelling: ['cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

async function setup(state: JobState = 'queued') {
  let tick = 0;
  const repository = new InMemoryReviewRepository();
  const machine = new JobStateMachine(repository, () => new Date(Date.UTC(2026, 8, 29, 10, 0, tick++)));
  const created = await repository.createJob(jobRecord({ state }));
  if (!created.created) throw new Error('unreachable');

  return { repository, machine, id: created.job.id };
}

describe('job state machine rules', () => {
  it.each(STATES.flatMap((from) => STATES.map((to) => [from, to] as const)))(
    '%s -> %s',
    (from, to) => {
      expect(canTransition(from, to)).toBe(LEGAL[from].includes(to));
    },
  );

  it('knows which states are terminal', () => {
    expect(STATES.filter(isTerminal)).toEqual(['completed', 'failed', 'cancelled']);
  });
});

describe('JobStateMachine', () => {
  it('walks the happy path and persists every transition', async () => {
    const { machine, repository, id } = await setup();

    for (const to of ['preparing', 'reviewing', 'verifying', 'rendering'] as const) {
      expect((await machine.transition(id, to)).applied).toBe(true);
    }

    expect((await repository.getJob(id))?.state).toBe('rendering');
  });

  it('rejects illegal jumps loudly', async () => {
    const { machine, id } = await setup('queued');

    await expect(machine.transition(id, 'completed')).rejects.toBeInstanceOf(IllegalTransitionError);
    await expect(machine.transition(id, 'verifying')).rejects.toThrow(/queued -> verifying/);
  });

  it('treats terminal states as idempotent sinks', async () => {
    const { machine, repository, id } = await setup('reviewing');
    expect((await machine.transition(id, 'failed', { failureReason: 'first' })).applied).toBe(true);

    for (const to of ['failed', 'cancelling', 'cancelled', 'completed'] as const) {
      const again = await machine.transition(id, to, { failureReason: 'second' });
      expect(again.applied).toBe(false);
    }

    expect(await repository.getJob(id)).toMatchObject({ state: 'failed', failureReason: 'first' });
  });

  it('lets a failure lose to an in-flight cancellation', async () => {
    const { machine, repository, id } = await setup('reviewing');
    await machine.transition(id, 'cancelling');

    const failed = await machine.transition(id, 'failed');

    expect(failed.applied).toBe(false);
    expect((await repository.getJob(id))?.state).toBe('cancelling');
  });

  it('serializes competing transitions into one consistent history', async () => {
    const { machine, repository, id } = await setup('reviewing');

    const results = await Promise.all([
      machine.transition(id, 'verifying'),
      machine.transition(id, 'cancelling'),
      machine.transition(id, 'failed'),
    ]);

    const final = await repository.getJob(id);
    expect(results.filter((result) => result.applied).length).toBeGreaterThanOrEqual(1);
    expect(['verifying', 'cancelling', 'failed']).toContain(final?.state);
    // No transition may be lost silently: the persisted state was reported applied.
    expect(results.some((result) => result.applied && result.job.state === final?.state)).toBe(true);
  });

  it('resolves the cancel-versus-complete race to exactly one terminal state', async () => {
    for (let round = 0; round < 40; round += 1) {
      const { machine, repository, id } = await setup('rendering');
      const report = {
        jobId: id,
        report: {
          reviewId: id,
          executiveSummary: 'ok',
          overallRisk: 'clean' as const,
          findings: [],
          decisions: [],
          acceptedCount: 0,
          rejectedCount: 0,
          mergedCount: 0,
          warnings: [],
          exclusions: [],
        },
        markdown: '# r',
        durationMs: 1,
        createdAt: '2026-09-29T10:05:00.000Z',
      };
      const complete = () =>
        repository.completeJob({ jobId: id, report, finalFindings: [], at: report.createdAt });
      const cancel = async () => {
        const cancelling = await machine.transition(id, 'cancelling');
        if (cancelling.applied) await machine.transition(id, 'cancelled');
      };

      await Promise.all(round % 2 === 0 ? [complete(), cancel()] : [cancel(), complete()]);

      const job = await repository.getJob(id);
      const storedReport = await repository.getReport(id);
      expect(['completed', 'cancelled']).toContain(job?.state);
      expect(storedReport !== null).toBe(job?.state === 'completed');
    }
  });

  it('records timestamps and applies patches with the transition', async () => {
    const { machine, id } = await setup('reviewing');

    const result = await machine.transition(id, 'failed', { failureReason: 'All reviewers failed.' });

    expect(result.applied && result.job).toMatchObject({
      state: 'failed',
      failureReason: 'All reviewers failed.',
      completedAt: expect.any(String),
    });
  });

  it('reports a missing job without throwing', async () => {
    const { machine } = await setup();

    expect(await machine.transition('nope', 'preparing')).toEqual({ applied: false, job: null });
  });
});
