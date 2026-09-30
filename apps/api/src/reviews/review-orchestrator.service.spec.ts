import { readFile } from 'node:fs/promises';

import type { CreateReviewRequest, ReviewFinding } from '@pr-orchestrator/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEX,
  GEMINI,
  Gate,
  acceptAll,
  candidatesFromPrompt,
  completed,
  createHarness,
  failed,
  hangUntilAborted,
  reviewerJson,
  standardsSnapshot,
  timedOut,
  toWire,
  verifierJson,
  wireFinding,
  type Harness,
  type HarnessOptions,
  type Script,
} from '../../../../tests/fixtures/fake-clis/orchestrator-harness.js';
import { jobRecord, settings as makeSettings } from '../../../../tests/fixtures/fake-clis/engine-fixtures.js';
import { waitFor } from '../../../../tests/fixtures/fake-clis/scenarios.js';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';
import { ActiveReviewExistsError, ReviewNotFoundError } from './review-errors.js';
import { toReviewJob } from './review-job.mapper.js';

const harnesses: Harness[] = [];
async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const created = await createHarness(options);
  harnesses.push(created);

  return created;
}
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((created) => created.dispose()));
});

const reviewerOk = (title = 'Unchecked null dereference in loader'): Script => (request) =>
  completed('codex', request, reviewerJson([wireFinding({ title })]));
const verifierAcceptAll: Script = (request) => completed('claude', request, acceptAll(request.prompt));

async function runToEnd(h: Harness, overrides: Partial<CreateReviewRequest> = {}) {
  const job = await h.orchestrator.createReview(h.request(overrides));
  await h.orchestrator.awaitCompletion(job.id);
  const record = await h.repository.getJob(job.id);
  if (!record) throw new Error('job vanished');

  return { id: job.id, record, runs: await h.repository.listRuns(job.id) };
}

function twoReviewers(): HarnessOptions {
  return {
    scripts: {
      codex: (request) => completed('codex', request, reviewerJson([wireFinding({ title: 'Codex finding about the loader' })])),
      gemini: (request) => completed('gemini', request, reviewerJson([wireFinding({ title: 'Gemini finding about the parser', filePath: 'src/parser.ts' })])),
      claude: verifierAcceptAll,
    },
  };
}

describe('ReviewOrchestratorService — happy path', () => {
  it('runs prepare, review, verify, render, complete, and stores an immutable report', async () => {
    const h = await harness(twoReviewers());

    const { id, record, runs } = await runToEnd(h);

    expect(record.state).toBe('completed');
    expect(h.log.filter((entry) => entry.startsWith('job:'))).toEqual([
      'job:preparing',
      'job:reviewing',
      'job:verifying',
      'job:rendering',
      'job:completed',
    ]);
    const report = await h.repository.getReport(id);
    expect(report?.report.findings).toHaveLength(2);
    expect(report?.report.acceptedCount).toBe(2);
    expect(report?.markdown).toMatch(/^# Pull request review:/u);
    expect(report?.markdown).toContain('Codex finding about the loader');
    expect(record.overallRisk).toBe('high');
    expect(record.findingCount).toBe(2);
    expect(record.completedAt).not.toBeNull();
    expect(runs.filter((run) => run.role === 'reviewer').every((run) => run.state === 'completed')).toBe(true);
    expect(runs.find((run) => run.role === 'verifier')?.state).toBe('completed');
    expect(await h.repository.listCandidates(id)).toHaveLength(2);
    expect(h.workspace.cleaned).toEqual([`ws-${id}`]);
    expect(record.cleanupPending).toBe(false);
  });

  it('gives providers the prompt on stdin, the workspace as cwd, a schema file, and the configured timeouts', async () => {
    const h = await harness(twoReviewers());

    await runToEnd(h);

    const request = h.providers.adapters.codex.calls[0];
    expect(request?.workspacePath).toBe('/work/job');
    expect(request?.timeoutMs).toBe(600_000);
    expect(request?.model).toBe('cli-default');
    expect(request?.prompt).toContain('/work/job/checkout');
    expect(request?.outputSchemaPath).toMatch(/schema/u);
    expect(h.providers.adapters.claude.calls[0]?.timeoutMs).toBe(600_000);
  });

  it('removes its scratch directory after every outcome', async () => {
    const h = await harness(twoReviewers());
    await runToEnd(h);
    expect(await h.scratchEntries()).toEqual([]);

    const failing = await harness({ scripts: { codex: (r) => failed('codex', r, 'boom'), gemini: (r) => failed('gemini', r, 'boom') } });
    await runToEnd(failing);
    expect(await failing.scratchEntries()).toEqual([]);
  });

  it('writes the JSON schema file the provider is told to read', async () => {
    let schemaType = '';
    const h = await harness({
      scripts: {
        ...twoReviewers().scripts,
        codex: async (request) => {
          schemaType = (JSON.parse(await readFile(request.outputSchemaPath, 'utf8')) as { type: string }).type;

          return completed('codex', request, reviewerJson());
        },
      },
    });

    const { record } = await runToEnd(h);

    expect(schemaType).toBe('object');
    expect(record.state).toBe('completed');
  });

  it('keeps reviewers independent: no reviewer sees another reviewer or its findings', async () => {
    const h = await harness(twoReviewers());

    await runToEnd(h);

    const codexPrompt = h.providers.adapters.codex.calls[0]?.prompt ?? '';
    const geminiPrompt = h.providers.adapters.gemini.calls[0]?.prompt ?? '';
    expect(codexPrompt).not.toContain('Gemini finding about the parser');
    expect(geminiPrompt).not.toContain('Codex finding about the loader');
    expect(codexPrompt).not.toMatch(/gemini/iu);
    expect(geminiPrompt).not.toMatch(/codex/iu);
  });

  it('passes additional instructions, defaulting to the settings value', async () => {
    const h = await harness(twoReviewers());
    h.settings.current = makeSettings({ defaultAdditionalInstructions: 'Focus on error handling.' });

    await runToEnd(h);
    expect(h.providers.adapters.codex.calls[0]?.prompt).toContain('Focus on error handling.');

    const explicit = await harness(twoReviewers());
    explicit.settings.current = makeSettings({ defaultAdditionalInstructions: 'Focus on error handling.' });
    await runToEnd(explicit, { additionalInstructions: 'Focus on security.' });
    expect(explicit.providers.adapters.codex.calls[0]?.prompt).toContain('Focus on security.');
    expect(explicit.providers.adapters.codex.calls[0]?.prompt).not.toContain('Focus on error handling.');
  });
});

describe('ReviewOrchestratorService — reviewer outcomes', () => {
  it('continues with a partial result when one reviewer times out and discloses it', async () => {
    const h = await harness({
      scripts: { codex: reviewerOk(), gemini: (request) => timedOut('gemini', request), claude: verifierAcceptAll },
    });

    const { id, record, runs } = await runToEnd(h);

    expect(record.state).toBe('completed');
    expect(runs.find((run) => run.selection.provider === 'gemini')).toMatchObject({ state: 'timed_out' });
    expect(record.warnings.some((warning) => /gemini\/pro.*timed out.*partial/iu.test(warning))).toBe(true);
    expect((await h.repository.getReport(id))?.report.warnings.join(' ')).toMatch(/gemini\/pro.*timed out/iu);
    expect(h.providers.adapters.claude.calls[0]?.prompt).toMatch(/gemini\/pro.*timed out/iu);
  });

  it('corrects one malformed structured response with a single extra attempt', async () => {
    const h = await harness({
      scripts: {
        codex: (request, index) =>
          completed('codex', request, index === 0 ? 'I found a bug, sorry, no JSON' : reviewerJson([wireFinding()])),
        gemini: reviewerOk(),
        claude: verifierAcceptAll,
      },
    });

    const { record, runs } = await runToEnd(h);

    const codexCalls = h.providers.adapters.codex.calls;
    expect(codexCalls).toHaveLength(2);
    expect(codexCalls[1]?.prompt).toContain('CORRECTION REQUIRED');
    expect(codexCalls[1]?.runId).not.toBe(codexCalls[0]?.runId);
    expect(record.state).toBe('completed');
    expect(runs.find((run) => run.selection.provider === 'codex')).toMatchObject({ state: 'completed', attempts: 2 });
  });

  it('fails a reviewer that is malformed twice and never tries a third time', async () => {
    const h = await harness({
      scripts: { codex: (request) => completed('codex', request, '{"findings": "nope"}'), gemini: reviewerOk(), claude: verifierAcceptAll },
    });

    const { record, runs } = await runToEnd(h);

    expect(h.providers.adapters.codex.calls).toHaveLength(2);
    expect(runs.find((run) => run.selection.provider === 'codex')).toMatchObject({ state: 'failed', attempts: 2 });
    expect(record.state).toBe('completed');
    expect(record.warnings.some((warning) => /codex\/cli-default.*invalid structured output.*partial/iu.test(warning))).toBe(true);
  });

  it('records a reviewer whose adapter throws as failed without failing the job', async () => {
    const h = await harness({
      scripts: {
        codex: () => {
          throw new Error('adapter exploded');
        },
        gemini: reviewerOk(),
        claude: verifierAcceptAll,
      },
    });

    const { record, runs } = await runToEnd(h);

    expect(record.state).toBe('completed');
    expect(runs.find((run) => run.selection.provider === 'codex')?.state).toBe('failed');
  });

  it('fails the review, skips the verifier, and cleans up when every reviewer fails', async () => {
    const h = await harness({
      scripts: {
        codex: (request) => failed('codex', request, 'codex is not logged in'),
        gemini: (request) => timedOut('gemini', request),
        claude: verifierAcceptAll,
      },
    });

    const { id, record } = await runToEnd(h);

    expect(record.state).toBe('failed');
    expect(record.failureReason).toMatch(/all reviewers failed/iu);
    expect(record.failureReason).toContain('codex is not logged in');
    expect(h.providers.adapters.claude.calls).toHaveLength(0);
    expect(await h.repository.getReport(id)).toBeNull();
    expect(h.workspace.cleaned).toEqual([`ws-${id}`]);
  });

  it('records normalized reviewer exclusions and workspace exclusions in the report', async () => {
    const h = await harness({
      scripts: {
        codex: (request) => completed('codex', request, reviewerJson([wireFinding()], { exclusions: [{ path: 'dist/bundle.js', reason: 'Generated bundle' }, { path: '../evil', reason: 'x' }] })),
        gemini: reviewerOk(),
        claude: verifierAcceptAll,
      },
    });
    h.workspace.exclusions = [{ path: 'package-lock.json', reason: 'Lock file' }];

    const { id } = await runToEnd(h);

    const exclusions = (await h.repository.getReport(id))?.report.exclusions.map((entry) => entry.path).sort();
    expect(exclusions).toEqual(['dist/bundle.js', 'package-lock.json']);
  });

  it('never stores raw transcripts or secrets in the run log, and bounds its size', async () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const h = await harness({
      scripts: {
        codex: (request) => completed('codex', request, `RAW-TRANSCRIPT-MARKER ${'y'.repeat(5_000)}`, `${secret} ${'x'.repeat(10_000)}`),
        gemini: reviewerOk(),
        claude: verifierAcceptAll,
      },
    });

    const { record, runs } = await runToEnd(h);

    const run = runs.find((candidate) => candidate.selection.provider === 'codex');
    const visible = JSON.stringify([run, record.warnings]);
    expect(visible).not.toContain(secret);
    expect(visible).not.toContain('RAW-TRANSCRIPT-MARKER');
    expect(run?.sanitizedLog.length ?? 0).toBeLessThanOrEqual(4_096);
  });
});

describe('ReviewOrchestratorService — main verifier', () => {
  it('corrects a malformed verifier answer once', async () => {
    const h = await harness({
      scripts: {
        codex: reviewerOk(),
        gemini: reviewerOk('Another finding on parsing'),
        claude: (request, index) => completed('claude', request, index === 0 ? 'not json' : acceptAll(request.prompt)),
      },
    });

    const { record } = await runToEnd(h);

    expect(h.providers.adapters.claude.calls).toHaveLength(2);
    expect(h.providers.adapters.claude.calls[1]?.prompt).toContain('CORRECTION REQUIRED');
    expect(record.state).toBe('completed');
  });

  it('fails the job, keeps candidates for audit, and stores no report when the verifier fails', async () => {
    const h = await harness({
      scripts: { codex: reviewerOk(), gemini: reviewerOk('Second finding'), claude: (request) => timedOut('claude', request) },
    });

    const { id, record, runs } = await runToEnd(h);

    expect(record.state).toBe('failed');
    expect(record.failureReason).toMatch(/verifier/iu);
    expect(runs.find((run) => run.role === 'verifier')?.state).toBe('timed_out');
    expect(await h.repository.listCandidates(id)).toHaveLength(2);
    expect(await h.repository.getReport(id)).toBeNull();
    expect(h.workspace.cleaned).toEqual([`ws-${id}`]);
  });

  type Build = (ids: string[], candidates: ReviewFinding[]) => string;
  const decision = (candidate: ReviewFinding, verdict: 'accepted' | 'merged' = 'accepted') => ({
    candidateIds: [candidate.id],
    verdict,
    rationale: 'ok',
    finding: toWire(candidate),
  });
  const reject = (id: string) => ({ candidateIds: [id], verdict: 'rejected' as const, rationale: 'no', finding: null });
  const violations: Array<[string, Build]> = [
    ['omits a candidate', (_ids, [a]) => verifierJson([decision(a as ReviewFinding)])],
    ['decides a candidate twice', (ids, [a]) =>
      verifierJson([decision(a as ReviewFinding), { candidateIds: ids, verdict: 'rejected', rationale: 'no', finding: null }])],
    ['invents a candidate id', (ids, [a, b]) =>
      verifierJson([decision(a as ReviewFinding), decision(b as ReviewFinding), reject('00000000-0000-4000-8000-00000000dead')])],
    ['accepts several candidates as one', (ids, [a]) =>
      verifierJson([{ ...decision(a as ReviewFinding), candidateIds: ids }])],
    ['merges a single candidate', (ids, [a]) =>
      verifierJson([decision(a as ReviewFinding, 'merged'), reject(ids[1] as string)])],
    ['reports a finding outside the checkout', (ids, [a]) =>
      verifierJson([{ ...decision(a as ReviewFinding), finding: { ...toWire(a as ReviewFinding), filePath: '../../etc/passwd' } }, reject(ids[1] as string)])],
  ];

  it.each(violations)('rejects a verifier that %s, allows one correction, then fails the job', async (_name, build) => {
    const h = await harness({
      scripts: {
        codex: reviewerOk('First finding'),
        gemini: reviewerOk('Second finding'),
        claude: (request) => {
          const candidates = candidatesFromPrompt(request.prompt);

          return completed('claude', request, build(candidates.map((candidate) => candidate.id), candidates));
        },
      },
    });

    const { id, record } = await runToEnd(h);

    expect(h.providers.adapters.claude.calls).toHaveLength(2);
    expect(record.state).toBe('failed');
    expect(record.failureReason).toMatch(/verifier/iu);
    expect(await h.repository.getReport(id)).toBeNull();
  });

  it('accepts a verifier that fixes an integrity violation on its correction attempt', async () => {
    const h = await harness({
      scripts: {
        codex: reviewerOk('First finding'),
        gemini: reviewerOk('Second finding'),
        claude: (request, index) => {
          if (index > 0) return completed('claude', request, acceptAll(request.prompt));
          const [first] = candidatesFromPrompt(request.prompt);

          return completed('claude', request, verifierJson([decision(first as ReviewFinding)]));
        },
      },
    });

    const { id, record } = await runToEnd(h);

    expect(record.state).toBe('completed');
    expect((await h.repository.getReport(id))?.report.findings).toHaveLength(2);
    expect(h.providers.adapters.claude.calls[1]?.prompt).toMatch(/omitted|missing|every candidate/iu);
  });

  it('keeps rejected candidates in the audit data but never among verified findings', async () => {
    const h = await harness({
      scripts: {
        codex: reviewerOk('Real defect in the loader'),
        gemini: reviewerOk('Imagined defect in the parser'),
        claude: (request) => {
          const candidates = candidatesFromPrompt(request.prompt);

          return completed('claude', request, verifierJson(candidates.map((candidate) =>
            candidate.title.startsWith('Real') ? decision(candidate) : { ...reject(candidate.id), rationale: 'The guard exists on line 11.' })));
        },
      },
    });

    const { id, record } = await runToEnd(h);

    const stored = await h.repository.getReport(id);
    expect(stored?.report.findings.map((entry) => entry.title)).toEqual(['Real defect in the loader']);
    expect(stored?.report.rejectedCount).toBe(1);
    expect(stored?.report.decisions).toHaveLength(2);
    expect(stored?.markdown).toContain('Imagined defect in the parser');
    expect(stored?.markdown.split('Audit trail')[0]).not.toContain('Imagined defect');
    expect(await h.repository.listCandidates(id)).toHaveLength(2);
    expect(record.findingCount).toBe(1);
  });

  it('derives origins from the decided candidates, merges them, and keeps counts consistent', async () => {
    const h = await harness({
      scripts: {
        codex: (request) => completed('codex', request, reviewerJson([wireFinding({ title: 'Loader dereferences null' })])),
        gemini: (request) => completed('gemini', request, reviewerJson([wireFinding({ title: 'Config value used unchecked', severity: 'medium' }), wireFinding({ title: 'Unrelated style issue', filePath: 'src/style.ts', severity: 'low' })])),
        claude: (request) => {
          const candidates = candidatesFromPrompt(request.prompt);
          const same = candidates.filter((candidate) => candidate.filePath === 'src/loader.ts');
          const other = candidates.filter((candidate) => candidate.filePath !== 'src/loader.ts');

          return completed('claude', request, verifierJson([
            { candidateIds: same.map((candidate) => candidate.id), verdict: 'merged', rationale: 'Same defect.', finding: { ...toWire(same[0] as ReviewFinding), title: 'Loader reads config value without a null check' } },
            ...other.map((candidate) => reject(candidate.id)),
          ]));
        },
      },
    });

    const { id, record } = await runToEnd(h);

    const stored = await h.repository.getReport(id);
    const [merged] = stored?.report.findings ?? [];
    expect(stored?.report.findings).toHaveLength(1);
    expect(merged?.origins).toEqual([CODEX, GEMINI]);
    expect(stored?.report).toMatchObject({ acceptedCount: 0, mergedCount: 2, rejectedCount: 1, overallRisk: 'high' });
    expect(record.overallRisk).toBe('high');
  });

  it('skips the verifier and reports a clean review when reviewers find nothing', async () => {
    const h = await harness({
      scripts: { codex: (r) => completed('codex', r, reviewerJson([])), gemini: (r) => completed('gemini', r, reviewerJson([])), claude: verifierAcceptAll },
    });

    const { id, record } = await runToEnd(h);

    expect(record).toMatchObject({ state: 'completed', overallRisk: 'clean', findingCount: 0 });
    expect(h.providers.adapters.claude.calls).toHaveLength(0);
    expect((await h.repository.getReport(id))?.markdown).toContain('No verified findings.');
  });

  it('gives the verifier only real candidates with their reviewer origins', async () => {
    const h = await harness(twoReviewers());

    await runToEnd(h);

    const candidates = candidatesFromPrompt(h.providers.adapters.claude.calls[0]?.prompt ?? '');
    expect(candidates.map((candidate) => candidate.origins[0]?.provider).sort()).toEqual(['codex', 'gemini']);
  });
});

describe('ReviewOrchestratorService — concurrency and standards', () => {
  const manyReviewers = ['m1', 'm2', 'm3', 'm4', 'm5'].map((model) => ({ provider: 'codex' as const, model }));
  const slowReviewer: Script = async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 30));

    return completed('codex', request, reviewerJson([wireFinding({ title: `Finding from ${request.model}` })]));
  };

  it('runs up to three reviewers at once and never more', async () => {
    const h = await harness({ scripts: { codex: slowReviewer, claude: verifierAcceptAll } });

    await runToEnd(h, { reviewers: manyReviewers });

    expect(h.probe.max).toBe(3);
  });

  it('honours a lower configured limit', async () => {
    const h = await harness({ scripts: { codex: slowReviewer, claude: verifierAcceptAll } });
    h.settings.current = makeSettings({ maxParallelReviewers: 2 });

    await runToEnd(h, { reviewers: manyReviewers });

    expect(h.probe.max).toBe(2);
  });

  it('never exceeds three even if settings claim more', async () => {
    const h = await harness({ scripts: { codex: slowReviewer, claude: verifierAcceptAll } });
    h.settings.current = { ...makeSettings(), maxParallelReviewers: 8 };

    await runToEnd(h, { reviewers: manyReviewers });

    expect(h.probe.max).toBe(3);
  });

  it('snapshots standards once at creation; a later replacement changes nothing for the running job', async () => {
    const h = await harness({
      scripts: {
        codex: (request) => {
          h.standards.current = standardsSnapshot('replacement.md', 'b');

          return completed('codex', request, reviewerJson());
        },
        gemini: reviewerOk('Second'),
        claude: verifierAcceptAll,
      },
    });
    h.standards.current = standardsSnapshot('original.md', 'a');

    const { id, record } = await runToEnd(h);

    expect(h.standards.calls).toBe(1);
    expect(record.standards?.filename).toBe('original.md');
    expect(h.workspace.prepared[0]?.standards?.storagePath).toBe('/standards/a/original.md');
    expect(h.providers.adapters.gemini.calls[0]?.prompt).toContain('/standards/a/original.md');
    const markdown = (await h.repository.getReport(id))?.markdown ?? '';
    expect(markdown).toContain('original.md');
    expect(markdown).not.toContain('replacement.md');
  });

  it('uses the fallback guidance and says so when no standards exist', async () => {
    const h = await harness(twoReviewers());

    const { id, record } = await runToEnd(h);

    expect(record.standards).toBeNull();
    expect((await h.repository.getReport(id))?.markdown).toMatch(/no project standards file/iu);
  });

  it('freezes settings at creation', async () => {
    const h = await harness(twoReviewers());
    h.settings.current = makeSettings({ reviewerTimeoutMs: 120_000 });

    const { record } = await runToEnd(h);

    expect(record.settings.reviewerTimeoutMs).toBe(120_000);
    expect(h.providers.adapters.codex.calls[0]?.timeoutMs).toBe(120_000);
  });
});

describe('ReviewOrchestratorService — creation', () => {
  it('rejects a provider that is not selectable and creates nothing', async () => {
    const h = await harness(twoReviewers());
    h.providers.blocked.add('gemini/pro');

    await expect(h.orchestrator.createReview(h.request())).rejects.toThrow(/not ready/u);

    expect(await h.repository.getActiveJob()).toBeNull();
    expect(h.workspace.prepared).toHaveLength(0);
    expect(h.standards.calls).toBe(0);
  });

  it('rejects the main verifier when it is not selectable', async () => {
    const h = await harness(twoReviewers());
    h.providers.blocked.add('claude/opus');

    await expect(h.orchestrator.createReview(h.request())).rejects.toThrow(/not ready/u);
  });

  it('rejects malformed requests, including duplicate reviewers', async () => {
    const h = await harness(twoReviewers());

    await expect(h.orchestrator.createReview(h.request({ reviewers: [CODEX, CODEX] }))).rejects.toThrow();
    await expect(h.orchestrator.createReview({ ...h.request(), unexpected: true } as CreateReviewRequest)).rejects.toThrow();
    expect(await h.repository.getActiveJob()).toBeNull();
  });

  it('propagates pull-request validation failures without creating a job', async () => {
    const h = await harness(twoReviewers());
    h.pullRequests.error = new Error('PR is not reachable');

    await expect(h.orchestrator.createReview(h.request())).rejects.toThrow('PR is not reachable');
    expect(await h.repository.getActiveJob()).toBeNull();
  });

  it('lets exactly one of several simultaneous creators win', async () => {
    const gate = new Gate();
    const h = await harness({
      scripts: {
        codex: async (request) => {
          await gate.opened;

          return completed('codex', request, reviewerJson());
        },
        gemini: reviewerOk('Second'),
        claude: verifierAcceptAll,
      },
    });

    const results = await Promise.allSettled([1, 2, 3, 4].map(() => h.orchestrator.createReview(h.request())));

    const winners = results.filter((result) => result.status === 'fulfilled');
    const losers = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(3);
    expect(losers.every((loser) => loser.reason instanceof ActiveReviewExistsError)).toBe(true);
    expect(h.standards.calls).toBe(1);
    const [winner] = winners;
    if (winner?.status !== 'fulfilled') throw new Error('unreachable');
    const [firstLoser] = losers;
    if (!firstLoser) throw new Error('unreachable');
    expect((firstLoser.reason as ActiveReviewExistsError).activeJobId).toBe(winner.value.id);
    gate.open();
    await h.orchestrator.awaitCompletion(winner.value.id);
    expect(h.workspace.prepared).toHaveLength(1);
  });

  it('accepts a new review once the previous one is terminal', async () => {
    const h = await harness(twoReviewers());
    await runToEnd(h);

    const second = await runToEnd(h);

    expect(second.record.state).toBe('completed');
  });

  it('returns a queued snapshot with one queued run per reviewer', async () => {
    const gate = new Gate();
    const h = await harness({
      scripts: {
        ...twoReviewers().scripts,
        codex: async (request) => {
          await gate.opened;

          return completed('codex', request, reviewerJson());
        },
      },
    });

    const job = await h.orchestrator.createReview(h.request());

    expect(job.state).toBe('queued');
    expect(job.reviewers.map((run) => run.selection)).toEqual([CODEX, GEMINI]);
    gate.open();
    await h.orchestrator.awaitCompletion(job.id);
  });
});

describe('ReviewOrchestratorService — workspace lifecycle', () => {
  it('fails the job with a redacted reason when workspace preparation fails', async () => {
    const h = await harness(twoReviewers());
    h.workspace.prepareError = new Error('clone failed for https://user:hunter2secret@dev.azure.com/acme with token sk-abcdefghijklmnopqrstuvwxyz123456');

    const { record } = await runToEnd(h);

    expect(record.state).toBe('failed');
    expect(record.failureReason).toMatch(/workspace/iu);
    expect(record.failureReason).not.toContain('hunter2secret');
    expect(record.failureReason).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(h.providers.adapters.codex.calls).toHaveLength(0);
  });

  it('keeps a completed review completed but flags pending cleanup when cleanup fails, then retries', async () => {
    const h = await harness(twoReviewers());
    h.workspace.cleanupFailures = 1;

    const { id, record } = await runToEnd(h);

    expect(record.state).toBe('completed');
    expect(record.cleanupPending).toBe(true);
    expect(record.warnings.join(' ')).toMatch(/cleanup/iu);
    expect(await h.repository.getReport(id)).not.toBeNull();

    await h.orchestrator.retryPendingCleanups();

    expect((await h.repository.getJob(id))?.cleanupPending).toBe(false);
    expect(h.workspace.cleaned).toEqual([`ws-${id}`, `ws-${id}`]);
  });

  it('recovers a job interrupted by a restart: fails it, frees the lock, and cleans up', async () => {
    const repository = new InMemoryReviewRepository();
    const h = await harness({ repository });
    const stranded = jobRecord({ state: 'reviewing', workspaceId: 'ws-stranded', cleanupPending: true });
    await repository.createJob(stranded);

    await h.orchestrator.recoverOnStartup();

    const after = await repository.getJob(stranded.id);
    expect(after).toMatchObject({ state: 'failed', cleanupPending: false });
    expect(after?.failureReason).toMatch(/restart/iu);
    expect(h.workspace.cleaned).toEqual(['ws-stranded']);
    expect(await repository.getActiveJob()).toBeNull();
  });
});

describe('ReviewOrchestratorService — cancellation', () => {
  it('cancels a review whose reviewers are running: aborts them, skips the verifier, ends cancelled', async () => {
    const h = await harness({
      scripts: {
        codex: (request) => hangUntilAborted('codex', request),
        gemini: (request) => hangUntilAborted('gemini', request),
        claude: verifierAcceptAll,
      },
    });
    const job = await h.orchestrator.createReview(h.request());
    await waitFor(() => h.providers.adapters.codex.calls.length === 1 && h.providers.adapters.gemini.calls.length === 1);

    const cancelling = await h.orchestrator.cancelReview(job.id);
    expect(cancelling.state).toBe('cancelling');
    await h.orchestrator.awaitCompletion(job.id);

    const record = await h.repository.getJob(job.id);
    const runs = await h.repository.listRuns(job.id);
    expect(record?.state).toBe('cancelled');
    expect(runs.filter((run) => run.role === 'reviewer').map((run) => run.state)).toEqual(['cancelled', 'cancelled']);
    expect(h.providers.adapters.codex.cancelledRuns).toContain(h.providers.adapters.codex.calls[0]?.runId);
    expect(h.providers.adapters.claude.calls).toHaveLength(0);
    expect(await h.repository.getReport(job.id)).toBeNull();
    expect(h.workspace.cleaned).toEqual([`ws-${job.id}`]);
    expect(h.log.filter((entry) => entry.startsWith('job:')).slice(-2)).toEqual(['job:cancelling', 'job:cancelled']);
  });

  it('cancels while the workspace is still being prepared', async () => {
    const h = await harness(twoReviewers());
    h.workspace.hangPrepare = true;
    const job = await h.orchestrator.createReview(h.request());
    await waitFor(() => h.workspace.prepared.length === 1);

    await h.orchestrator.cancelReview(job.id);
    await h.orchestrator.awaitCompletion(job.id);

    expect((await h.repository.getJob(job.id))?.state).toBe('cancelled');
    expect(h.providers.adapters.codex.calls).toHaveLength(0);
  });

  it('cancels during verification', async () => {
    const h = await harness({
      scripts: { codex: reviewerOk(), gemini: reviewerOk('Second'), claude: (request) => hangUntilAborted('claude', request) },
    });
    const job = await h.orchestrator.createReview(h.request());
    await waitFor(() => h.providers.adapters.claude.calls.length === 1);

    await h.orchestrator.cancelReview(job.id);
    await h.orchestrator.awaitCompletion(job.id);

    expect((await h.repository.getJob(job.id))?.state).toBe('cancelled');
    expect((await h.repository.listRuns(job.id)).find((run) => run.role === 'verifier')?.state).toBe('cancelled');
    expect(await h.repository.getReport(job.id)).toBeNull();
  });

  it('is idempotent and safe for unknown or finished reviews', async () => {
    const h = await harness(twoReviewers());
    const { id } = await runToEnd(h);

    const late = await h.orchestrator.cancelReview(id);
    expect(late.state).toBe('completed');
    expect((await h.repository.getJob(id))?.state).toBe('completed');
    expect(await h.repository.getReport(id)).not.toBeNull();

    await expect(h.orchestrator.cancelReview('00000000-0000-4000-8000-00000000ffff')).rejects.toBeInstanceOf(ReviewNotFoundError);
  });

  it('ends cancelled, with no report, when cancellation wins the race against completion', async () => {
    class CancelWinsRepository extends InMemoryReviewRepository {
      override async completeJob(input: Parameters<InMemoryReviewRepository['completeJob']>[0]) {
        await this.transitionJob({ jobId: input.jobId, expectedFrom: 'rendering', to: 'cancelling', at: input.at });

        return super.completeJob(input);
      }
    }
    const repository = new CancelWinsRepository();
    const h = await harness({ ...twoReviewers(), repository });

    const { id, record } = await runToEnd(h);

    expect(record.state).toBe('cancelled');
    expect(record.overallRisk).toBeNull();
    expect(await repository.getReport(id)).toBeNull();
    expect(h.workspace.cleaned).toEqual([`ws-${id}`]);
  });

  it('finishes an orphaned review (no pipeline in this process) when it is cancelled', async () => {
    const repository = new InMemoryReviewRepository();
    const h = await harness({ repository });
    const orphan = jobRecord({ state: 'reviewing', workspaceId: 'ws-orphan', cleanupPending: true });
    await repository.createJob(orphan);

    const result = await h.orchestrator.cancelReview(orphan.id);

    expect(result.state).toBe('cancelled');
    expect((await repository.getJob(orphan.id))?.cleanupPending).toBe(false);
    expect(h.workspace.cleaned).toEqual(['ws-orphan']);
    expect(await repository.getActiveJob()).toBeNull();
  });

  it('cancelling twice in a row is harmless', async () => {
    const h = await harness({ scripts: { codex: (r) => hangUntilAborted('codex', r), gemini: (r) => hangUntilAborted('gemini', r) } });
    const job = await h.orchestrator.createReview(h.request());
    await waitFor(() => h.providers.adapters.codex.calls.length === 1);

    await Promise.all([h.orchestrator.cancelReview(job.id), h.orchestrator.cancelReview(job.id)]);
    await h.orchestrator.awaitCompletion(job.id);

    expect((await h.repository.getJob(job.id))?.state).toBe('cancelled');
  });
});

describe('ReviewOrchestratorService — events', () => {
  it('streams a snapshot first, then monotonic events, and closes at the terminal state', async () => {
    const gate = new Gate();
    const h = await harness({
      scripts: {
        ...twoReviewers().scripts,
        codex: async (request) => {
          await gate.opened;

          return completed('codex', request, reviewerJson());
        },
      },
    });
    const job = await h.orchestrator.createReview(h.request());
    const received: Array<{ type: string; sequence: number }> = [];
    let closed = false;
    h.events
      .stream(job.id, async () => {
        const record = await h.repository.getJob(job.id);

        return record ? toReviewJob(record, await h.repository.listRuns(job.id)) : null;
      })
      .subscribe({ next: (event) => received.push(event), complete: () => { closed = true; } });

    gate.open();
    await h.orchestrator.awaitCompletion(job.id);
    await waitFor(() => closed);

    expect(received[0]?.type).toBe('job.snapshot');
    const sequences = received.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(received.at(-1)?.type).toBe('job.state_changed');
    expect(h.events.listenerCount(job.id)).toBe(0);
  });

  const loadFrom = (h: Harness, id: string) => async () => {
    const record = await h.repository.getJob(id);

    return record ? toReviewJob(record, await h.repository.listRuns(id)) : null;
  };

  it.each([
    ['completed', {}],
    ['failed', { scripts: { codex: (request: Parameters<Script>[0]) => failed('codex', request, 'boom'), gemini: (request: Parameters<Script>[0]) => failed('gemini', request, 'boom') } }],
  ] as const)('gives a client reconnecting after a %s review the final persisted sequence', async (state, options) => {
    const h = await harness(state === 'completed' ? twoReviewers() : (options as HarnessOptions));
    const job = await h.orchestrator.createReview(h.request());
    const live: Array<{ type: string; sequence: number }> = [];
    h.events.stream(job.id, loadFrom(h, job.id)).subscribe({ next: (event) => live.push(event) });
    await h.orchestrator.awaitCompletion(job.id);
    expect((await h.repository.getJob(job.id))?.state).toBe(state);

    const late: Array<{ type: string; sequence: number }> = [];
    let closed = false;
    h.events.stream(job.id, loadFrom(h, job.id)).subscribe({ next: (event) => late.push(event), complete: () => { closed = true; } });
    await waitFor(() => closed);

    const finalSequence = live.at(-1)?.sequence ?? 0;
    expect(finalSequence).toBeGreaterThan(1);
    expect(await h.repository.getEventSequence(job.id)).toBe(finalSequence);
    expect(late).toEqual([expect.objectContaining({ type: 'job.snapshot', sequence: finalSequence })]);
    expect(h.events.trackedReviewCount()).toBe(0);
  });

  it('gives a client reconnecting after a cancelled review the final persisted sequence', async () => {
    const h = await harness({ scripts: { codex: hangUntilAborted.bind(null, 'codex'), gemini: hangUntilAborted.bind(null, 'gemini') } });
    const job = await h.orchestrator.createReview(h.request());
    await waitFor(() => h.providers.adapters.codex.calls.length > 0);
    await h.orchestrator.cancelReview(job.id);
    await h.orchestrator.awaitCompletion(job.id);

    const late: Array<{ type: string; sequence: number }> = [];
    h.events.stream(job.id, loadFrom(h, job.id)).subscribe({ next: (event) => late.push(event) });
    await waitFor(() => late.length > 0);

    expect(late[0]).toMatchObject({ type: 'job.snapshot', sequence: await h.repository.getEventSequence(job.id) });
    expect(late[0]?.sequence).toBeGreaterThan(0);
  });

  it('continues numbering after a restart instead of starting again at 1', async () => {
    const repository = new InMemoryReviewRepository();
    const first = await harness({ ...twoReviewers(), repository });
    const done = await runToEnd(first);
    const before = await repository.getEventSequence(done.id);

    const second = await harness({ ...twoReviewers(), repository }); // new process, same database
    const next = await runToEnd(second);
    const received: Array<{ sequence: number }> = [];
    second.events.stream(done.id, loadFrom(second, done.id)).subscribe({ next: (event) => received.push(event) });
    await waitFor(() => received.length > 0);

    expect(received[0]?.sequence).toBe(before);
    expect(await repository.getEventSequence(next.id)).toBeGreaterThan(0);
  });

  it('persists reviewer warnings before announcing them, so a snapshot at that sequence contains them', async () => {
    const h = await harness({
      scripts: {
        codex: (request) => completed('codex', request, reviewerJson()),
        gemini: (request) => timedOut('gemini', request),
        claude: verifierAcceptAll,
      },
    });
    const checks: Array<Promise<boolean>> = [];
    const warning = h.events.warning.bind(h.events);
    h.events.warning = (reviewId, code, message) => {
      checks.push(h.repository.getJob(reviewId).then((job) => job?.warnings.includes(message) ?? false));
      warning(reviewId, code, message);
    };

    await runToEnd(h);

    expect(checks.length).toBeGreaterThan(0);
    expect(await Promise.all(checks)).toEqual(checks.map(() => true));
  });
});

