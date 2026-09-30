import { isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

import type {
  AuthenticationState,
  ModelCatalog,
  ProviderId,
} from '@pr-orchestrator/contracts';

import { buildChildEnvironment } from '../process/environment-policy.js';
import type { ProcessRunResult } from '../process/process-runner.types.js';
import type { ProcessSupervisor } from '../process/process-supervisor.service.js';
import type {
  CliLocator,
  ProviderAdapter,
  ProviderFailure,
  ProviderInstallation,
  ProviderRunRequest,
  ProviderRunResult,
  ResolvedExecutable,
} from '../provider-adapter.js';
import { collectSecretValues, redactSecrets } from '../redact-secrets.js';
import { assertCommandPolicy, assertSafeModelId } from './adapter-command-policy.js';
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

  protected abstract buildArguments(request: ProviderRunRequest): string[];

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
      if (!isAbsolute(request.workspacePath) || !isAbsolute(request.outputSchemaPath)) {
        throw new Error('workspacePath and outputSchemaPath must be absolute paths');
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

    let args: string[];
    try {
      args = this.buildArguments(request);
      assertCommandPolicy(this.id, args, request.prompt);
    } catch (error) {
      return fail({ kind: 'invalid_request', message: errorMessage(error) });
    }

    const parent = this.parentEnvironment();
    const result = await this.dependencies.supervisor.run({
      runId: request.runId,
      executablePath: installation.executable.executablePath,
      args: [...installation.executable.prefixArgs, ...args],
      cwd: request.workspacePath,
      stdin: request.prompt,
      timeoutMs: request.timeoutMs,
      maxStdoutBytes: request.maxStdoutBytes ?? DEFAULT_OUTPUT_BYTES,
      maxStderrBytes: request.maxStderrBytes ?? DEFAULT_OUTPUT_BYTES,
      environment: buildChildEnvironment({
        parent,
        provider: this.id,
        overrides: { NO_COLOR: '1' },
      }),
      signal: request.signal,
    });

    return this.mapResult(base, result, collectSecretValues(parent));
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
    result: ProcessRunResult,
    secrets: readonly string[],
  ): ProviderRunResult {
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
