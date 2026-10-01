import { isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

import type {
  AuthenticationState,
  ModelCatalog,
  ProviderId,
} from '@pr-orchestrator/contracts';

import { toObservation } from '../activity/activity-observation.js';
import { JsonLineSplitter } from '../activity/json-line-splitter.js';
import { isObject, type ActivityEmitter, type StreamDecoder } from '../activity/stream-decoder.js';
import { buildChildEnvironment } from '../process/environment-policy.js';
import type { ProcessRunResult } from '../process/process-runner.types.js';
import type { ProcessSupervisor } from '../process/process-supervisor.service.js';
import type {
  CliLocator,
  ProviderAdapter,
  ProviderFailure,
  ProviderActivitySink,
  ProviderInstallation,
  ProviderRunRequest,
  ProviderRunResult,
  ResolvedExecutable,
} from '../provider-adapter.js';
import { collectSecretValues, redactSecrets } from '../redact-secrets.js';
import {
  NATIVE_REASONING_EFFORTS,
  assertCommandPolicy,
  assertSafeModelId,
} from './adapter-command-policy.js';
import { classifyProviderFailure } from './provider-failure.js';

export interface CliAdapterDependencies {
  supervisor: ProcessSupervisor;
  locator: CliLocator;
  /** Source of the parent environment; defaults to `process.env`. */
  environment?: () => Readonly<Record<string, string | undefined>>;
  probeTimeoutMs?: number;
  /** Model names read from the user's own CLI configuration. */
  configuredModels?: readonly string[];
}

const DEFAULT_PROBE_TIMEOUT_MS = 15_000;
const PROBE_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_OUTPUT_BYTES = 1_048_576;
/**
 * In streaming mode the raw stdout buffer is not the answer channel (the
 * decoder retains that), and keeping it would hold tool results such as file
 * contents in memory. A small buffer satisfies the supervisor's contract.
 */
const STREAM_RAW_STDOUT_BYTES = 4_096;
/** Upper bound for one JSONL event line; longer lines are dropped whole. */
const MAX_STREAM_LINE_BYTES = 24 * 1_048_576;
const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)/u;

export type Version = readonly [number, number, number];

export function parseVersion(text: string): { text: string; parts: Version } | undefined {
  const match = VERSION_PATTERN.exec(text);
  if (!match) return undefined;

  return {
    text: `${match[1]}.${match[2]}.${match[3]}`,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
  };
}

export function isVersionAtLeast(version: Version, minimum: Version): boolean {
  for (let index = 0; index < 3; index += 1) {
    const left = version[index] as number;
    const right = minimum[index] as number;
    if (left !== right) return left > right;
  }

  return true;
}

export interface ProbeResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export abstract class BaseCliAdapter implements ProviderAdapter {
  abstract readonly id: ProviderId;

  private probeCounter = 0;
  private cachedInstallation: ProviderInstallation | undefined;

  protected constructor(protected readonly dependencies: CliAdapterDependencies) {}

  /** Reads the provider's version and verifies the CLI supports the read-only contract. */
  protected abstract assessSupport(
    executable: ResolvedExecutable,
    version: string | undefined,
  ): Promise<string | undefined>;

  /** `stream` is true when `createStreamDecoder` returned a decoder for this run. */
  protected abstract buildArguments(request: ProviderRunRequest, stream: boolean): string[];

  /**
   * Returns a decoder for the CLI's structured event stream, or undefined when
   * the installed CLI cannot stream (the run is then observable as liveness only).
   */
  protected createStreamDecoder(_emit: ActivityEmitter, _maxFinalBytes: number): StreamDecoder | undefined {
    return undefined;
  }

  abstract checkAuthentication(): Promise<AuthenticationState>;

  abstract listModels(): Promise<ModelCatalog>;

  /**
   * Some CLIs report failures inside a successful (exit 0) JSON envelope; return
   * the failure text so it is classified like a process failure.
   */
  protected inspectCompletedOutput(_stdout: string): string | undefined {
    return undefined;
  }

  async detectInstallation(): Promise<ProviderInstallation> {
    const executable = this.dependencies.locator.locate(this.id);
    if (!executable) {
      this.cachedInstallation = { installed: false };

      return this.cachedInstallation;
    }

    const versionProbe = await this.probe(executable, ['--version']);
    const version = parseVersion(`${versionProbe.stdout}\n${versionProbe.stderr}`)?.text;
    const unsupportedReason =
      !versionProbe.ok || version === undefined
        ? `Could not read the ${this.id} CLI version (\`${this.id} --version\` failed).`
        : await this.assessSupport(executable, version);

    this.cachedInstallation = {
      installed: true,
      executable,
      displayPath: executable.prefixArgs[0] ?? executable.executablePath,
      ...(version === undefined ? {} : { version }),
      ...(unsupportedReason === undefined ? {} : { unsupportedReason }),
    };

    return this.cachedInstallation;
  }

  async runReview(request: ProviderRunRequest): Promise<ProviderRunResult> {
    const base = { provider: this.id, runId: request.runId };
    const fail = (failure: ProviderFailure): ProviderRunResult => ({
      ...base,
      status: 'failed',
      durationMs: 0,
      failure,
    });

    try {
      assertSafeModelId(request.model);
      // Never drop an explicit effort silently, even for a provider without a mechanism.
      const effort = request.reasoningEffort;
      if (effort !== undefined && effort !== 'default' && !NATIVE_REASONING_EFFORTS[this.id].has(effort)) {
        throw new Error(`Reasoning effort "${effort}" cannot be applied by the ${this.id} CLI`);
      }
      if (!isAbsolute(request.workspacePath) || !isAbsolute(request.outputSchemaPath)) {
        throw new Error('workspacePath and outputSchemaPath must be absolute paths');
      }
      if ((request.readOnlyDirectories ?? []).some((directory) => !isAbsolute(directory))) {
        throw new Error('readOnlyDirectories must be absolute paths');
      }
    } catch (error) {
      return fail({ kind: 'invalid_request', message: errorMessage(error) });
    }

    const installation = await this.installation();
    if (!installation.installed || !installation.executable) {
      return fail({
        kind: 'not_installed',
        message: `The ${this.id} CLI is not installed or was not found on PATH.`,
      });
    }
    if (installation.unsupportedReason !== undefined) {
      return fail({ kind: 'unsupported', message: installation.unsupportedReason });
    }

    const parent = this.parentEnvironment();
    const secrets = collectSecretValues(parent);
    const maxStdoutBytes = request.maxStdoutBytes ?? DEFAULT_OUTPUT_BYTES;
    const sink = request.activity;
    const emit: ActivityEmitter = (raw) => {
      if (!sink) return;
      guard(() => sink.activity(toObservation(raw, request.workspacePath, secrets)));
    };
    const decoder = this.createStreamDecoder(emit, maxStdoutBytes);

    let args: string[];
    try {
      args = this.buildArguments(request, decoder !== undefined);
      assertCommandPolicy(this.id, args, request.prompt);
    } catch (error) {
      return fail({ kind: 'invalid_request', message: errorMessage(error) });
    }

    const stream = decoder ? streamReader(decoder, maxStdoutBytes) : undefined;
    if (sink) guard(() => sink.visibility(decoder ? decoder.visibility : 'heartbeat_only'));

    const result = await this.dependencies.supervisor.run({
      runId: request.runId,
      executablePath: installation.executable.executablePath,
      args: [...installation.executable.prefixArgs, ...args],
      cwd: request.workspacePath,
      stdin: request.prompt,
      timeoutMs: request.timeoutMs,
      maxStdoutBytes: stream ? STREAM_RAW_STDOUT_BYTES : maxStdoutBytes,
      maxStderrBytes: request.maxStderrBytes ?? DEFAULT_OUTPUT_BYTES,
      environment: buildChildEnvironment({
        parent,
        provider: this.id,
        overrides: { NO_COLOR: '1' },
      }),
      signal: request.signal,
      ...(stream ? { onStdout: (chunk: Buffer) => stream.splitter.push(chunk) } : {}),
    });

    if (stream) {
      guard(() => stream.splitter.end());
      reportSkipped(sink, stream.skipped());
    }

    return this.mapResult(base, result, secrets, stream);
  }

  async cancel(runId: string): Promise<void> {
    await this.dependencies.supervisor.cancel(runId);
  }

  protected parentEnvironment(): Readonly<Record<string, string | undefined>> {
    return this.dependencies.environment?.() ?? process.env;
  }

  protected async installation(): Promise<ProviderInstallation> {
    return this.cachedInstallation ?? this.detectInstallation();
  }

  /** Runs a short, non-billable CLI query such as `--version` or `auth status`. */
  protected async probe(
    executable: ResolvedExecutable,
    args: readonly string[],
  ): Promise<ProbeResult> {
    this.probeCounter += 1;
    const result = await this.dependencies.supervisor.run({
      runId: `probe:${this.id}:${this.probeCounter}:${Date.now()}`,
      executablePath: executable.executablePath,
      args: [...executable.prefixArgs, ...args],
      cwd: tmpdir(),
      stdin: '',
      timeoutMs: this.dependencies.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      maxStdoutBytes: PROBE_OUTPUT_BYTES,
      maxStderrBytes: PROBE_OUTPUT_BYTES,
      environment: buildChildEnvironment({
        parent: this.parentEnvironment(),
        provider: this.id,
        overrides: { NO_COLOR: '1' },
      }),
      signal: new AbortController().signal,
    });

    return {
      ok: result.status === 'completed',
      exitCode: result.status === 'completed' ? 0 : result.status === 'failed' ? result.exitCode : null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  private mapResult(
    base: { provider: ProviderId; runId: string },
    processResult: ProcessRunResult,
    secrets: readonly string[],
    stream?: StreamReader,
  ): ProviderRunResult {
    const result = stream ? streamedResult(processResult, stream) : processResult;
    const durationMs = result.durationMs;

    switch (result.status) {
      case 'timed_out':
        return { ...base, status: 'timed_out', durationMs };
      case 'cancelled':
        return { ...base, status: 'cancelled', durationMs };
      case 'failed': {
        if (result.error?.code === 'ENOENT') {
          return {
            ...base,
            status: 'failed',
            durationMs,
            failure: {
              kind: 'not_installed',
              message: `The ${this.id} executable could not be started (not found).`,
            },
          };
        }

        return {
          ...base,
          status: 'failed',
          durationMs,
          failure: classifyProviderFailure({
            provider: this.id,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            secrets,
          }),
        };
      }
      case 'completed': {
        if (result.stdoutTruncated) {
          return {
            ...base,
            status: 'failed',
            durationMs,
            failure: {
              kind: 'output_truncated',
              message: `${this.id} produced more than the configured stdout limit; the answer is incomplete.`,
            },
          };
        }

        const embeddedFailure = this.inspectCompletedOutput(result.stdout);
        if (embeddedFailure !== undefined) {
          return {
            ...base,
            status: 'failed',
            durationMs,
            failure: classifyProviderFailure({
              provider: this.id,
              exitCode: 0,
              stdout: embeddedFailure,
              stderr: result.stderr,
              secrets,
            }),
          };
        }

        return {
          ...base,
          status: 'completed',
          durationMs,
          rawOutput: result.stdout,
          stderr: redactSecrets(result.stderr, secrets),
        };
      }
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface StreamReader {
  decoder: StreamDecoder;
  splitter: JsonLineSplitter;
  /** Malformed (non-JSON, non-object, decoder-rejected) plus oversized lines. */
  skipped(): number;
}

function streamReader(decoder: StreamDecoder, maxStdoutBytes: number): StreamReader {
  let malformed = 0;
  // An event line wraps the answer in JSON (escaping, envelope fields), so it may
  // be larger than the answer itself; the decoder applies the answer cap.
  const lineCap = Math.min(MAX_STREAM_LINE_BYTES, maxStdoutBytes * 2 + 65_536);
  const splitter = new JsonLineSplitter(lineCap, (line) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed += 1;

      return;
    }
    if (!isObject(parsed)) {
      malformed += 1;

      return;
    }
    try {
      decoder.handle(parsed, line);
    } catch {
      malformed += 1;
    }
  });

  return { decoder, splitter, skipped: () => malformed + splitter.dropped };
}

/**
 * Replaces the raw stdout of a streamed run with the decoder's final-answer
 * channel, so the existing truncation, embedded-error and failure
 * classification logic applies unchanged.
 */
function streamedResult(result: ProcessRunResult, stream: StreamReader): ProcessRunResult {
  const { decoder, splitter } = stream;
  const final = decoder.finalOutput();

  if (result.status === 'completed') {
    // A dropped oversized line with no answer found is most likely the answer.
    const truncated = decoder.finalTruncated || (final === undefined && splitter.dropped > 0);

    return { ...result, stdout: truncated ? '' : (final ?? ''), stdoutTruncated: truncated };
  }
  if (result.status === 'failed') {
    return { ...result, stdout: decoder.diagnostics() || final || '', stdoutTruncated: false };
  }

  return result;
}

/** Activity observers must never affect a run. */
function guard(action: () => void): void {
  try {
    action();
  } catch {
    // Ignored by design.
  }
}

function reportSkipped(sink: ProviderActivitySink | undefined, count: number): void {
  if (sink && count > 0) guard(() => sink.skipped(count));
}
