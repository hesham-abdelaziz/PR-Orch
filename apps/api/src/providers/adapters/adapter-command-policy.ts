import type { ProviderId } from '@pr-orchestrator/contracts';

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

function modelArgs(model: string): string[] {
  assertSafeModelId(model);

  return model === CLI_DEFAULT_MODEL ? [] : ['--model', model];
}

export function buildClaudeReviewArgs(input: { model: string; schemaJson: string }): string[] {
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
    ...modelArgs(input.model),
  ];
}

export function buildCodexReviewArgs(input: {
  model: string;
  schemaPath: string;
  workspacePath: string;
}): string[] {
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
    // "-" makes codex read the prompt from stdin.
    '-',
  ];
}

export function buildGeminiReviewArgs(input: { model: string; sandbox: boolean }): string[] {
  return [
    '--approval-mode',
    'plan',
    '--output-format',
    'json',
    ...(input.sandbox ? ['--sandbox'] : []),
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
    findModeViolation(provider, args);
  if (forbidden !== undefined) {
    throw new Error(`Command policy violation: write-capable or unrestricted option "${forbidden}"`);
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
