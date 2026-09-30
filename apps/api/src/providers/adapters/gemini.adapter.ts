import { join } from 'node:path';
import { homedir } from 'node:os';

import type { AuthenticationState, ModelCatalog } from '@pr-orchestrator/contracts';

import { buildModelCatalog } from '../model-catalog.service.js';
import type { ProviderRunRequest, ResolvedExecutable } from '../provider-adapter.js';
import { nodeFileSystem } from '../windows-cli-resolver.js';
import { buildGeminiReviewArgs } from './adapter-command-policy.js';
import { BaseCliAdapter, type CliAdapterDependencies } from './base-cli.adapter.js';
import { loginHint } from './provider-failure.js';

const MAINTAINED_MODELS = [
  { id: 'cli-default', label: "CLI default (the CLI's own configured model)" },
  { id: 'pro', label: 'Pro (alias)' },
  { id: 'flash', label: 'Flash (alias)' },
  { id: 'flash-lite', label: 'Flash-Lite (alias)' },
] as const;

export interface GeminiAdapterDependencies extends CliAdapterDependencies {
  /** True when a container/sandbox runtime exists so `--sandbox` can be requested. */
  sandboxAvailable?: () => boolean;
  homeDirectory?: string;
  fileSystem?: { isFile(path: string): boolean };
}

export class GeminiAdapter extends BaseCliAdapter {
  readonly id = 'gemini' as const;

  constructor(private readonly geminiDependencies: GeminiAdapterDependencies) {
    super(geminiDependencies);
  }

  protected override async assessSupport(
    executable: ResolvedExecutable,
  ): Promise<string | undefined> {
    const help = await this.probe(executable, ['--help']);
    const text = help.stdout;
    if (!text.includes('--approval-mode') || !/\bplan\b/u.test(text)) {
      return 'This Gemini CLI does not offer `--approval-mode plan`, so it cannot run read-only. Update it with `npm install -g @google/gemini-cli`.';
    }
    if (!text.includes('--output-format')) {
      return 'This Gemini CLI does not offer `--output-format json`. Update it with `npm install -g @google/gemini-cli`.';
    }

    return undefined;
  }

  protected override buildArguments(request: ProviderRunRequest): string[] {
    return buildGeminiReviewArgs({
      model: request.model,
      sandbox: this.geminiDependencies.sandboxAvailable?.() ?? false,
      readOnlyDirectories: request.readOnlyDirectories ?? [],
    });
  }

  protected override inspectCompletedOutput(stdout: string): string | undefined {
    try {
      const envelope = JSON.parse(stdout) as { error?: { message?: unknown } | null };
      if (!envelope.error) return undefined;

      return typeof envelope.error.message === 'string'
        ? envelope.error.message
        : 'Gemini reported an error';
    } catch {
      return undefined;
    }
  }

  async checkAuthentication(): Promise<AuthenticationState> {
    const installation = await this.installation();
    if (!installation.installed) {
      return { state: 'error', message: 'The gemini CLI is not installed or was not found on PATH.' };
    }

    // Gemini has no auth-status command. Inspect local configuration only: a
    // model request would consume usage, so validity is confirmed on first run.
    const environment = this.parentEnvironment();
    const home = this.geminiDependencies.homeDirectory ?? homedir();
    const files = this.geminiDependencies.fileSystem ?? nodeFileSystem;

    const hasApiKey = Boolean(environment['GEMINI_API_KEY'] ?? environment['GOOGLE_API_KEY']);
    const hasVertex =
      Boolean(environment['GOOGLE_GENAI_USE_VERTEXAI']) &&
      Boolean(environment['GOOGLE_CLOUD_PROJECT']);
    const hasServiceAccount = Boolean(environment['GOOGLE_APPLICATION_CREDENTIALS']);
    const hasOauth = files.isFile(join(home, '.gemini', 'oauth_creds.json'));

    if (hasApiKey || hasVertex || hasServiceAccount || hasOauth) {
      return {
        state: 'unknown_until_run',
        message: 'Credentials were found locally; the first review confirms they are valid.',
      };
    }

    return { state: 'unauthenticated', message: `No Gemini credentials found. ${loginHint('gemini')}` };
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
