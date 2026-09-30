import { describe, expect, it } from 'vitest';

import {
  CLI_DEFAULT_MODEL,
  assertCommandPolicy,
  assertSafeModelId,
  buildClaudeReviewArgs,
  buildCodexReviewArgs,
  buildGeminiReviewArgs,
} from './adapter-command-policy.js';

const SCHEMA = '{"type":"object"}';

describe('adapter command profiles', () => {
  it('builds the exact restricted Claude profile', () => {
    expect(buildClaudeReviewArgs({ model: 'sonnet', schemaJson: SCHEMA })).toEqual([
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      SCHEMA,
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
      '--model',
      'sonnet',
    ]);
  });

  it('builds the exact read-only Codex profile with a stdin prompt', () => {
    expect(
      buildCodexReviewArgs({
        model: 'my-model',
        schemaPath: 'C:\\runs\\schema.json',
        workspacePath: 'C:\\workspaces\\job-1',
      }),
    ).toEqual([
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
      'C:\\runs\\schema.json',
      '--cd',
      'C:\\workspaces\\job-1',
      '--model',
      'my-model',
      '-',
    ]);
  });

  it('builds the exact plan-mode Gemini profile, adding the sandbox only when supported', () => {
    expect(buildGeminiReviewArgs({ model: 'pro', sandbox: false })).toEqual([
      '--approval-mode',
      'plan',
      '--output-format',
      'json',
      '--model',
      'pro',
    ]);
    expect(buildGeminiReviewArgs({ model: 'pro', sandbox: true })).toEqual([
      '--approval-mode',
      'plan',
      '--output-format',
      'json',
      '--sandbox',
      '--model',
      'pro',
    ]);
  });

  it('omits the model flag for the CLI-default sentinel', () => {
    expect(
      buildClaudeReviewArgs({ model: CLI_DEFAULT_MODEL, schemaJson: SCHEMA }),
    ).not.toContain('--model');
    expect(
      buildCodexReviewArgs({
        model: CLI_DEFAULT_MODEL,
        schemaPath: '/s.json',
        workspacePath: '/w',
      }),
    ).not.toContain('--model');
    expect(
      buildGeminiReviewArgs({ model: CLI_DEFAULT_MODEL, sandbox: false }),
    ).not.toContain('--model');
  });
});

describe('assertSafeModelId', () => {
  it.each(['sonnet', 'claude-sonnet-5', 'gpt-x.1', 'gemini-2.5-pro', 'a:b/c_d'])(
    'accepts %s',
    (model) => {
      expect(() => assertSafeModelId(model)).not.toThrow();
    },
  );

  it.each([
    '--dangerously-skip-permissions',
    '-y',
    'a b',
    'a;b',
    '$(whoami)',
    '"quoted"',
    '',
    'x'.repeat(201),
    'model\nname',
  ])('rejects %j', (model) => {
    expect(() => assertSafeModelId(model)).toThrow(/model/i);
  });
});

describe('assertCommandPolicy', () => {
  const prompt = 'Review the pull request thoroughly and report every defect.';

  it('accepts each generated profile', () => {
    expect(() =>
      assertCommandPolicy(
        'claude',
        buildClaudeReviewArgs({ model: 'opus', schemaJson: SCHEMA }),
        prompt,
      ),
    ).not.toThrow();
    expect(() =>
      assertCommandPolicy(
        'codex',
        buildCodexReviewArgs({ model: 'm', schemaPath: '/s.json', workspacePath: '/w' }),
        prompt,
      ),
    ).not.toThrow();
    expect(() =>
      assertCommandPolicy('gemini', buildGeminiReviewArgs({ model: 'pro', sandbox: true }), prompt),
    ).not.toThrow();
  });

  it.each([
    ['claude', ['--dangerously-skip-permissions']],
    ['claude', ['--permission-mode', 'acceptEdits']],
    ['claude', ['--permission-mode', 'bypassPermissions']],
    ['claude', ['--allow-dangerously-skip-permissions']],
    ['codex', ['--sandbox', 'workspace-write']],
    ['codex', ['--sandbox', 'danger-full-access']],
    ['codex', ['--full-auto']],
    ['codex', ['--yolo']],
    ['codex', ['--dangerously-bypass-approvals-and-sandbox']],
    ['gemini', ['--approval-mode', 'yolo']],
    ['gemini', ['--approval-mode', 'auto_edit']],
    ['gemini', ['--approval-mode=yolo']],
    ['gemini', ['--yolo']],
    ['gemini', ['-y']],
  ] as const)('rejects write-capable flags for %s: %j', (provider, extra) => {
    const base =
      provider === 'claude'
        ? buildClaudeReviewArgs({ model: 'opus', schemaJson: SCHEMA })
        : provider === 'codex'
          ? buildCodexReviewArgs({ model: 'm', schemaPath: '/s', workspacePath: '/w' })
          : buildGeminiReviewArgs({ model: 'pro', sandbox: false });

    expect(() => assertCommandPolicy(provider, [...base, ...extra], prompt)).toThrow(
      /write-capable|forbidden|policy/i,
    );
  });

  it('rejects profiles that lack the required read-only controls', () => {
    expect(() => assertCommandPolicy('claude', ['-p'], prompt)).toThrow(/policy/i);
    expect(() => assertCommandPolicy('codex', ['exec', '-'], prompt)).toThrow(/policy/i);
    expect(() => assertCommandPolicy('gemini', ['--output-format', 'json'], prompt)).toThrow(
      /policy/i,
    );
  });

  it('rejects prompt text on the command line', () => {
    const args = [
      ...buildGeminiReviewArgs({ model: 'pro', sandbox: false }),
      prompt,
    ];

    expect(() => assertCommandPolicy('gemini', args, prompt)).toThrow(/prompt/i);
  });

  it('rejects command lines that exceed the Windows limit', () => {
    const args = buildClaudeReviewArgs({
      model: 'opus',
      schemaJson: `{"description":"${'x'.repeat(31_000)}"}`,
    });

    expect(() => assertCommandPolicy('claude', args, prompt)).toThrow(/too long/i);
  });
});
