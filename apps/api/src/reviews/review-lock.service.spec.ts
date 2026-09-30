import { describe, expect, it } from 'vitest';

import { jobRecord } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';
import { JobStateMachine } from './job-state-machine.js';
import { ReviewLockService } from './review-lock.service.js';

function setup() {
  const repository = new InMemoryReviewRepository();
  const clock = () => new Date('2026-09-29T11:00:00.000Z');
  const machine = new JobStateMachine(repository, clock);
  const lock = new ReviewLockService(repository, machine);

  return { repository, machine, lock };
}

describe('ReviewLockService', () => {
  it('lets exactly one of many simultaneous starts create a job', async () => {
    const { lock, repository } = setup();

    const results = await Promise.all(
      Array.from({ length: 12 }, () => lock.createExclusive(jobRecord())),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    const active = await repository.getActiveJob();
    for (const result of results.filter((entry) => !entry.created)) {
      expect(result).toMatchObject({ created: false, activeJobId: active?.id });
    }
  });

  it('reports the active job id to the loser', async () => {
    const { lock } = setup();
    const first = await lock.createExclusive(jobRecord());
    const second = await lock.createExclusive(jobRecord());

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, activeJobId: first.created ? first.job.id : '' });
  });

  it('serializes critical sections in call order', async () => {
    const { lock } = setup();
    const order: string[] = [];

    await Promise.all([
      lock.runExclusive(async () => {
        order.push('a:start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('a:end');
      }),
      lock.runExclusive(async () => {
        order.push('b:start');
        order.push('b:end');
      }),
    ]);

    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('keeps the lock usable after a failing critical section', async () => {
    const { lock } = setup();

    await expect(lock.runExclusive(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(lock.runExclusive(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('recovers jobs left active by a crash so the lock is free again', async () => {
    const { lock, repository } = setup();
    for (const state of ['reviewing', 'cancelling'] as const) {
      const fresh = setup();
      const created = await fresh.repository.createJob(jobRecord({ state, workspaceId: `ws-${state}` }));
      if (!created.created) throw new Error('unreachable');

      const recovered = await fresh.lock.recoverAfterRestart();

      expect(recovered).toEqual([
        {
          jobId: created.job.id,
          from: state,
          to: state === 'cancelling' ? 'cancelled' : 'failed',
          workspaceId: `ws-${state}`,
        },
      ]);
      const job = await fresh.repository.getJob(created.job.id);
      expect(job?.state).toBe(state === 'cancelling' ? 'cancelled' : 'failed');
      if (state === 'reviewing') {
        expect(job?.failureReason).toMatch(/interrupted/i);
      }
      expect((await fresh.lock.createExclusive(jobRecord())).created).toBe(true);
    }

    expect(await lock.recoverAfterRestart()).toEqual([]);
    expect(await repository.getActiveJob()).toBeNull();
  });

  it('leaves terminal jobs untouched during recovery', async () => {
    const { lock, repository } = setup();
    const done = await repository.createJob(jobRecord({ state: 'completed', completedAt: '2026-09-29T10:00:00.000Z' }));
    if (!done.created) throw new Error('unreachable');

    expect(await lock.recoverAfterRestart()).toEqual([]);
    expect((await repository.getJob(done.job.id))?.state).toBe('completed');
  });
});
