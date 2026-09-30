import type { AuthenticationState, ModelCatalog } from '@pr-orchestrator/contracts';

import { buildModelCatalog } from '../model-catalog.service.js';
import type { ProviderRunRequest, ResolvedExecutable } from '../provider-adapter.js';
import { buildCodexReviewArgs } from './adapter-command-policy.js';
import { BaseCliAdapter, type CliAdapterDependencies } from './base-cli.adapter.js';
import { loginHint } from './provider-failure.js';

// The Codex CLI documents no model-listing command or stable alias set, so the
// catalog is the CLI default plus models named in the user's own config.
const MAINTAINED_MODELS = [
  { id: 'cli-default', label: "CLI default (the CLI's own configured model)" },
] as const;

const REQUIRED_EXEC_FLAGS = ['--sandbox', '--ephemeral', '--output-schema', '--cd'] as const;

export class CodexAdapter extends BaseCliAdapter {
  readonly id = 'codex' as const;

  constructor(dependencies: CliAdapterDependencies) {
    super(dependencies);
  }

  protected override async assessSupport(
    executable: ResolvedExecutable,
  ): Promise<string | undefined> {
    const [global, exec] = await Promise.all([
      this.probe(executable, ['--help']),
      this.probe(executable, ['exec', '--help']),
    ]);

    const missing: string[] = [];
    if (!global.stdout.includes('--ask-for-approval')) missing.push('--ask-for-approval');
    for (const flag of REQUIRED_EXEC_FLAGS) {
      if (!exec.stdout.includes(flag)) missing.push(`exec ${flag}`);
    }

    return missing.length === 0
      ? undefined
      : `This Codex CLI lacks required read-only review options (${missing.join(', ')}). Update it with \`npm install -g @openai/codex\` or the native installer.`;
  }

  protected override buildArguments(request: ProviderRunRequest): string[] {
    return buildCodexReviewArgs({
      model: request.model,
      schemaPath: request.outputSchemaPath,
      workspacePath: request.workspacePath,
    });
  }

  async checkAuthentication(): Promise<AuthenticationState> {
    const installation = await this.installation();
    if (!installation.installed || !installation.executable) {
      return { state: 'error', message: 'The codex CLI is not installed or was not found on PATH.' };
    }

    // Exits 0 when credentials are present; makes no model request.
    const status = await this.probe(installation.executable, ['login', 'status']);
    if (status.ok) return { state: 'authenticated' };
    if (status.exitCode !== null && status.exitCode > 0 && status.exitCode < 10) {
      return { state: 'unauthenticated', message: `Codex CLI is not signed in. ${loginHint('codex')}` };
    }

    return { state: 'error', message: '`codex login status` failed unexpectedly. Check the CLI installation.' };
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
