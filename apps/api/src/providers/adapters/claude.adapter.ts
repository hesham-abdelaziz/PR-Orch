import { readFileSync } from 'node:fs';

import type { AuthenticationState, ModelCatalog, ReasoningEffort } from '@pr-orchestrator/contracts';

import { buildModelCatalog, type CatalogModel } from '../model-catalog.service.js';
import type { ProviderRunRequest, ResolvedExecutable } from '../provider-adapter.js';
import { buildClaudeReviewArgs } from './adapter-command-policy.js';
import {
  BaseCliAdapter,
  isVersionAtLeast,
  parseVersion,
  type CliAdapterDependencies,
} from './base-cli.adapter.js';
import { loginHint } from './provider-failure.js';

/**
 * `--permission-prompts` (v2.1.259) is the newest flag in the review profile;
 * `--restricted` arrived in v2.1.248.
 */
export const CLAUDE_MINIMUM_VERSION = [2, 1, 259] as const;

/**
 * Levels from https://code.claude.com/docs/en/model-config (checked 2026-09-30):
 * current Opus, Sonnet and Fable models accept low|medium|high|xhigh|max; Haiku
 * does not support effort. Aliases can resolve to an older model on some
 * platforms (e.g. Sonnet 4.5 on Bedrock); the CLI then falls back to the highest
 * supported level at or below the request, and organization caps can clamp it
 * further, so reports show the *requested* level only. `cli-default` resolves to
 * an unknown model and therefore stays Default-only.
 */
const CLAUDE_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const MAINTAINED_MODELS: readonly CatalogModel[] = [
  { id: 'cli-default', label: "CLI default (the CLI's own configured model)" },
  { id: 'sonnet', label: 'Sonnet (latest alias)', supportedReasoningEfforts: CLAUDE_EFFORTS },
  { id: 'opus', label: 'Opus (latest alias)', supportedReasoningEfforts: CLAUDE_EFFORTS },
  { id: 'haiku', label: 'Haiku (latest alias)' },
  { id: 'fable', label: 'Fable (latest alias)', supportedReasoningEfforts: CLAUDE_EFFORTS },
];

export class ClaudeAdapter extends BaseCliAdapter {
  readonly id = 'claude' as const;

  constructor(dependencies: CliAdapterDependencies) {
    super(dependencies);
  }

  protected override assessSupport(
    _executable: ResolvedExecutable,
    version: string | undefined,
  ): Promise<string | undefined> {
    const parsed = version === undefined ? undefined : parseVersion(version);
    if (parsed && isVersionAtLeast(parsed.parts, CLAUDE_MINIMUM_VERSION)) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve(
      `Claude Code ${CLAUDE_MINIMUM_VERSION.join('.')} or newer is required for restricted, prompt-free review mode (found ${version ?? 'unknown'}). Run \`claude update\`.`,
    );
  }

  protected override buildArguments(request: ProviderRunRequest): string[] {
    let schemaJson: string;
    try {
      schemaJson = JSON.stringify(JSON.parse(readFileSync(request.outputSchemaPath, 'utf8')));
    } catch {
      throw new Error('The output schema file is unreadable or is not valid JSON');
    }

    return buildClaudeReviewArgs({
      model: request.model,
      schemaJson,
      readOnlyDirectories: request.readOnlyDirectories ?? [],
      ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
    });
  }

  protected override inspectCompletedOutput(stdout: string): string | undefined {
    try {
      const envelope = JSON.parse(stdout) as { is_error?: unknown; result?: unknown };

      if (envelope.is_error !== true) return undefined;

      return typeof envelope.result === 'string' ? envelope.result : 'Claude reported an error';
    } catch {
      return undefined;
    }
  }

  async checkAuthentication(): Promise<AuthenticationState> {
    const installation = await this.installation();
    if (!installation.installed || !installation.executable) {
      return { state: 'error', message: 'The claude CLI is not installed or was not found on PATH.' };
    }

    // Exits 0 when logged in and 1 when not; makes no model request.
    const status = await this.probe(installation.executable, ['auth', 'status']);
    if (status.ok) return { state: 'authenticated' };
    if (status.exitCode === 1) {
      return { state: 'unauthenticated', message: `Claude CLI is not signed in. ${loginHint('claude')}` };
    }

    return { state: 'error', message: '`claude auth status` failed unexpectedly. Check the CLI installation.' };
  }

  async listModels(): Promise<ModelCatalog> {
    const installation = await this.installation();

    return buildModelCatalog({
      maintained: MAINTAINED_MODELS,
      configured: this.dependencies.configuredModels ?? [],
      ...(installation.unsupportedReason ? { unavailableReason: installation.unsupportedReason } : {}),
    });
  }
}
