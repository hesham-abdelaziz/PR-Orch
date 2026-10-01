import type { ProviderId, ReasoningEffort } from '@pr-orchestrator/contracts';

/** Sentinel model id meaning "omit --model and use the CLI's own configured default". */
export const CLI_DEFAULT_MODEL = 'cli-default';

/** Windows CreateProcess limits the whole command line to 32,767 characters. */
const MAX_COMMAND_LINE_LENGTH = 30_000;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;

export function isSafeModelId(model: string): boolean {
  return MODEL_ID_PATTERN.test(model);
}

/** Model ids reach the argv, so anything option-like or shell-shaped is refused. */
export function assertSafeModelId(model: string): void {
  if (!isSafeModelId(model)) {
    throw new Error(
      'Invalid model identifier: use letters, digits, and . _ : / - only, starting with a letter or digit',
    );
  }
}

/**
 * Effort values each CLI accepts natively, verified against the providers' docs
 * (Claude Code `--effort`: low|medium|high|xhigh|max; Codex
 * `model_reasoning_effort`: minimal|low|medium|high|xhigh). Only the levels our
 * shared vocabulary also names are allowed; Claude's `ultracode` workflow mode
 * is deliberately excluded because it is not a model effort level.
 */
export const NATIVE_REASONING_EFFORTS: Readonly<Record<ProviderId, ReadonlySet<ReasoningEffort>>> = {
  claude: new Set<ReasoningEffort>(['low', 'medium', 'high', 'xhigh', 'max']),
  codex: new Set<ReasoningEffort>(['low', 'medium', 'high', 'xhigh']),
  // No verified per-run thinking overlay yet: Gemini runs at the CLI default.
  gemini: new Set<ReasoningEffort>(),
};

const CODEX_EFFORT_KEY = 'model_reasoning_effort';

/** Returns the explicit effort to apply, or undefined for "use the CLI default". */
function explicitEffort(provider: ProviderId, effort: ReasoningEffort | undefined): ReasoningEffort | undefined {
  if (effort === undefined || effort === 'default') return undefined;
  if (!NATIVE_REASONING_EFFORTS[provider].has(effort)) {
    throw new Error(`Reasoning effort "${effort}" is not supported by the ${provider} CLI`);
  }

  return effort;
}

function modelArgs(model: string): string[] {
  assertSafeModelId(model);

  return model === CLI_DEFAULT_MODEL ? [] : ['--model', model];
}

export function buildClaudeReviewArgs(input: {
  model: string;
  schemaJson: string;
  /** Directories outside the working directory that hold read-only context files. */
  readOnlyDirectories?: readonly string[];
  /** Requested effort; absent or 'default' leaves the CLI's own setting. */
  reasoningEffort?: ReasoningEffort;
}): string[] {
  const effort = explicitEffort('claude', input.reasoningEffort);

  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    input.schemaJson,
    '--permission-mode',
    'plan',
    '--permission-prompts',
    'none',
    '--restricted',
    '--tools',
    'Read,Grep,Glob',
    '--disallowedTools',
    'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,mcp__*',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    // --restricted confines file tools to the working directories; --add-dir
    // extends them. Plan mode plus the Read/Grep/Glob tool list keep it read-only.
    ...(input.readOnlyDirectories ?? []).flatMap((directory) => ['--add-dir', directory]),
    ...modelArgs(input.model),
    ...(effort === undefined ? [] : ['--effort', effort]),
  ];
}

export function buildCodexReviewArgs(input: {
  model: string;
  schemaPath: string;
  workspacePath: string;
  /** Requested effort; absent or 'default' leaves the CLI's own setting. */
  reasoningEffort?: ReasoningEffort;
}): string[] {
  const effort = explicitEffort('codex', input.reasoningEffort);

  return [
    // Global flag: it must precede the subcommand.
    '--ask-for-approval',
    'never',
    'exec',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--output-schema',
    input.schemaPath,
    '--cd',
    input.workspacePath,
    ...modelArgs(input.model),
    // Per-run config override (TOML value); never persisted to config.toml.
    ...(effort === undefined ? [] : ['-c', `${CODEX_EFFORT_KEY}="${effort}"`]),
    // "-" makes codex read the prompt from stdin.
    '-',
  ];
}

export function buildGeminiReviewArgs(input: {
  model: string;
  sandbox: boolean;
  readOnlyDirectories?: readonly string[];
}): string[] {
  const directories = input.readOnlyDirectories ?? [];
  if (directories.some((directory) => directory.includes(','))) {
    throw new Error('A context directory name contains a comma, which Gemini uses as its list separator');
  }

  return [
    '--approval-mode',
    'plan',
    '--output-format',
    'json',
    ...(input.sandbox ? ['--sandbox'] : []),
    ...(directories.length > 0 ? ['--include-directories', directories.join(',')] : []),
    ...modelArgs(input.model),
  ];
}

const FORBIDDEN_FLAGS: ReadonlySet<string> = new Set([
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '--full-auto',
  '--yolo',
  '-y',
]);

/** Flags that are safe for one provider but grant write access for another. */
const PROVIDER_FORBIDDEN_FLAGS: Readonly<Record<ProviderId, ReadonlySet<string>>> = {
  claude: new Set(),
  // `codex --add-dir` grants *write* access to the directory.
  codex: new Set(['--add-dir']),
  gemini: new Set(),
};

/** The only value each mode-selecting flag may ever take. */
const ALLOWED_MODE_VALUES: Readonly<Record<ProviderId, Readonly<Record<string, string>>>> = {
  claude: { '--permission-mode': 'plan' },
  codex: { '--sandbox': 'read-only', '--ask-for-approval': 'never' },
  gemini: { '--approval-mode': 'plan' },
};

function findModeViolation(provider: ProviderId, args: readonly string[]): string | undefined {
  const rules = ALLOWED_MODE_VALUES[provider];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;
    const separator = argument.indexOf('=');
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    const allowed = rules[flag];
    if (allowed === undefined) continue;

    const value = inlineValue ?? args[index + 1];
    if (value !== allowed) return `${flag} ${value ?? ''}`.trim();
  }

  return undefined;
}

function hasPair(args: readonly string[], flag: string, value: string): boolean {
  return args.some(
    (argument, index) =>
      (argument === flag && args[index + 1] === value) || argument === `${flag}=${value}`,
  );
}

/**
 * Last line of defence before spawning: refuses write-capable or unrestricted
 * modes, requires each provider's read-only controls, and keeps prompt text off
 * the command line.
 */
export function assertCommandPolicy(
  provider: ProviderId,
  args: readonly string[],
  prompt: string,
): void {
  const forbidden =
    args.find((argument) => FORBIDDEN_FLAGS.has(argument.toLowerCase())) ??
    args.find((argument) => PROVIDER_FORBIDDEN_FLAGS[provider].has(argument.split('=')[0]?.toLowerCase() ?? '')) ??
    findModeViolation(provider, args);
  if (forbidden !== undefined) {
    throw new Error(`Command policy violation: write-capable or unrestricted option "${forbidden}"`);
  }

  const overrideViolation = findConfigOverrideViolation(provider, args);
  if (overrideViolation !== undefined) {
    throw new Error(`Command policy violation: ${overrideViolation}`);
  }

  const missing = requiredControls(provider, args);
  if (missing !== undefined) {
    throw new Error(`Command policy violation: missing required read-only control ${missing}`);
  }

  const probe = prompt.trim().slice(0, 40);
  if (probe.length >= 8 && args.some((argument) => argument.includes(probe))) {
    throw new Error('Command policy violation: prompt text must be sent through stdin');
  }

  if (args.reduce((total, argument) => total + argument.length + 3, 0) > MAX_COMMAND_LINE_LENGTH) {
    throw new Error('Command policy violation: command line is too long for Windows');
  }
}

/**
 * Codex `-c key=value` can rewrite any config key, including `sandbox_mode` and
 * `approval_policy`, so the only override allowed is the reasoning effort with
 * a known value. Claude's `--effort` is likewise limited to model effort levels.
 */
function findConfigOverrideViolation(provider: ProviderId, args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] as string;

    if (provider === 'codex') {
      // Accepted spellings: `-c k=v`, `--config k=v`, `--config=k=v`, `-ck=v`.
      let value: string | undefined;
      let isOverride = true;
      if (argument === '-c' || argument === '--config') {
        value = args[index + 1];
        index += 1;
      } else if (argument.startsWith('--config=')) {
        value = argument.slice('--config='.length);
      } else if (argument.startsWith('-c') && !argument.startsWith('--')) {
        value = argument.slice(2);
      } else {
        isOverride = false;
      }
      if (isOverride && !isAllowedCodexOverride(value)) {
        return `config override "${value ?? ''}" is not permitted`;
      }
      continue;
    }

    if (provider === 'claude' && (argument === '--effort' || argument.startsWith('--effort='))) {
      const value = argument === '--effort' ? args[index + 1] : argument.slice('--effort='.length);
      if (value === undefined || !NATIVE_REASONING_EFFORTS.claude.has(value as ReasoningEffort)) {
        return `--effort value "${value ?? ''}" is not a supported reasoning effort`;
      }
    }
  }

  return undefined;
}

function isAllowedCodexOverride(value: string | undefined): boolean {
  if (value === undefined) return false;
  const match = /^model_reasoning_effort="([a-z]+)"$/u.exec(value);

  return match !== null && NATIVE_REASONING_EFFORTS.codex.has(match[1] as ReasoningEffort);
}

function requiredControls(provider: ProviderId, args: readonly string[]): string | undefined {
  switch (provider) {
    case 'claude':
      if (!args.includes('-p')) return '-p';
      if (!hasPair(args, '--permission-mode', 'plan')) return '--permission-mode plan';
      if (!args.includes('--restricted')) return '--restricted';
      if (!args.includes('--no-session-persistence')) return '--no-session-persistence';
      return undefined;
    case 'codex':
      if (!hasPair(args, '--sandbox', 'read-only')) return '--sandbox read-only';
      if (!hasPair(args, '--ask-for-approval', 'never')) return '--ask-for-approval never';
      if (!args.includes('--ephemeral')) return '--ephemeral';
      if (!args.includes('exec')) return 'exec';
      return undefined;
    case 'gemini':
      if (!hasPair(args, '--approval-mode', 'plan')) return '--approval-mode plan';
      return undefined;
  }
}
