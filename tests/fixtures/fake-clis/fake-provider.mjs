// Deterministic stand-ins for the claude, codex, and gemini executables.
// A generated wrapper script imports runFakeProvider with baked-in behavior,
// so tests never depend on environment variables that the engine filters out.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { REVIEWER_SUCCESS_PAYLOAD } from './fake-cli.mjs';

const DEFAULT_HELP = {
  claude: 'Usage: claude [options] [prompt]\n  --effort <level>  Effort level for the current session (low, medium, high, xhigh, max)\n',
  codex:
    'Usage: codex [OPTIONS] [PROMPT]\n  -c, --config <key=value>\n  -a, --ask-for-approval <POLICY>\n  -s, --sandbox <MODE>\n',
  'codex-exec':
    'Usage: codex exec [OPTIONS] [PROMPT]\n  -c, --config <key=value>\n  -s, --sandbox <MODE>\n  --ephemeral\n  --output-schema <FILE>\n  -C, --cd <DIR>\n',
  gemini:
    'Usage: gemini [options]\n  --approval-mode  choices: default, auto_edit, yolo, plan\n  -s, --sandbox\n  -o, --output-format\n',
};

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function payloadJson() {
  return JSON.stringify(REVIEWER_SUCCESS_PAYLOAD);
}

/** Set per invocation: the provider whose structured event stream was requested. */
let streamMode = null;

function detectStreamMode(provider, argv) {
  if (provider === 'codex') return argv.includes('--json') ? 'codex' : null;

  return argv.includes('stream-json') ? provider : null;
}

/**
 * Synthetic event streams shaped like each CLI's documented stream format. They
 * deliberately carry content that must never surface as activity (thinking
 * text, file contents, search patterns, command text and output).
 */
function streamLines(provider, text, structured, behavior) {
  const cwd = process.cwd();
  const separator = cwd.includes('\\') ? '\\' : '/';
  const file = `${cwd}${separator}src${separator}app.ts`;
  const prelude = behavior.streamPrelude ?? [];
  const json = (value) => JSON.stringify(value);

  if (provider === 'claude') {
    return [
      json({ type: 'system', subtype: 'init', session_id: '00000000-0000-4000-8000-000000000000', tools: ['Read', 'Grep', 'Glob'] }),
      ...prelude,
      json({ type: 'assistant', message: { content: [
        { type: 'thinking', thinking: 'PRIVATE-REASONING-TEXT' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: file, offset: 10, limit: 20 } },
      ] } }),
      json({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'FILE-CONTENT-MUST-NOT-LEAK' }] } }),
      json({ type: 'assistant', message: { content: [
        { type: 'tool_use', id: 'toolu_2', name: 'Grep', input: { pattern: 'SEARCH-PATTERN-MUST-NOT-LEAK', path: cwd } },
      ] } }),
      json({ type: 'assistant', message: { content: [{ type: 'text', text: 'Here is the review.' }] } }),
      envelope('claude', text, structured),
    ];
  }
  if (provider === 'codex') {
    return [
      json({ type: 'thread.started', thread_id: 'thread-1' }),
      json({ type: 'turn.started' }),
      ...prelude,
      json({ type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: 'PRIVATE-REASONING-TEXT' } }),
      json({ type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: "bash -lc 'cat COMMAND-MUST-NOT-LEAK'", status: 'in_progress' } }),
      json({ type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "bash -lc 'cat COMMAND-MUST-NOT-LEAK'", aggregated_output: 'OUTPUT-MUST-NOT-LEAK', exit_code: 0, status: 'completed' } }),
      json({ type: 'item.completed', item: { id: 'item_2', type: 'agent_message', text } }),
      json({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    ];
  }

  const half = Math.floor(text.length / 2);
  return [
    json({ type: 'init', session_id: 'session-1', model: 'fake' }),
    ...prelude,
    json({ type: 'tool_use', tool_name: 'read_file', tool_id: 'read-1', parameters: { file_path: file, offset: 9, limit: 20 } }),
    json({ type: 'tool_result', tool_id: 'read-1', status: 'success', output: 'FILE-CONTENT-MUST-NOT-LEAK' }),
    json({ type: 'message', role: 'assistant', content: text.slice(0, half), delta: true }),
    json({ type: 'message', role: 'assistant', content: text.slice(half), delta: true }),
    json({ type: 'result', status: 'success', stats: { total_tokens: 1 } }),
  ];
}

/** The full stdout of a successful (exit 0) run in the requested output format. */
function answer(provider, text, structured, behavior) {
  return streamMode
    ? `${streamLines(provider, text, structured, behavior).join('\n')}\n`
    : `${envelope(provider, text, structured)}\n`;
}

function envelope(provider, text, structured) {
  if (provider === 'claude') {
    return JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: text,
      ...(structured === undefined ? {} : { structured_output: structured }),
      session_id: '00000000-0000-4000-8000-000000000000',
    });
  }
  if (provider === 'gemini') {
    return JSON.stringify({ response: text, stats: { models: {} } });
  }

  return text;
}

function nextInvocationNumber(counterFile) {
  if (!counterFile) return 1;
  const previous = existsSync(counterFile)
    ? Number(readFileSync(counterFile, 'utf8')) || 0
    : 0;
  writeFileSync(counterFile, String(previous + 1));

  return previous + 1;
}

export async function runFakeProvider(provider, behavior = {}) {
  const argv = process.argv.slice(2);
  const version = behavior.version ?? '9.9.9';
  const authenticated = behavior.authenticated ?? true;

  if (argv.includes('--version') || argv[0] === '-v') {
    process.stdout.write(
      provider === 'claude'
        ? `${version} (Claude Code)\n`
        : provider === 'codex'
          ? `codex-cli ${version}\n`
          : `${version}\n`,
    );
    return 0;
  }

  if (provider === 'claude' && argv[0] === 'auth' && argv[1] === 'status') {
    process.stdout.write(
      `${JSON.stringify({ loggedIn: authenticated, authMethod: 'fake' })}\n`,
    );
    return authenticated ? 0 : 1;
  }

  if (provider === 'codex' && argv[0] === 'login' && argv[1] === 'status') {
    process.stdout.write(authenticated ? 'Logged in using fake\n' : 'Not logged in\n');
    return authenticated ? 0 : 1;
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    const key = provider === 'codex' && argv[0] === 'exec' ? 'codex-exec' : provider;
    process.stdout.write(behavior.help?.[key] ?? DEFAULT_HELP[key]);
    return 0;
  }

  // Anything else is a review run: record exactly what the engine sent. Effort
  // options (`--effort <level>`, `-c model_reasoning_effort="<level>"`) are
  // accepted like any other argument and captured in `argv` for assertions.
  const stdin = await readStdin();
  if (behavior.logFile) {
    appendFileSync(
      behavior.logFile,
      `${JSON.stringify({
        argv,
        stdin,
        cwd: process.cwd(),
        envKeys: Object.keys(process.env).sort(),
        env: process.env,
      })}\n`,
    );
  }

  const invocation = nextInvocationNumber(behavior.counterFile);
  streamMode = detectStreamMode(provider, argv);

  switch (behavior.run ?? 'success') {
    case 'success': {
      process.stdout.write(answer(provider, payloadJson(), REVIEWER_SUCCESS_PAYLOAD, behavior));
      return 0;
    }
    case 'malformed': {
      process.stdout.write(answer(provider, '{"findings": [ {"title": "cut', undefined, behavior));
      return 0;
    }
    case 'malformed-once': {
      process.stdout.write(
        invocation === 1
          ? answer(provider, 'Sure! Here you go: {oops', undefined, behavior)
          : answer(provider, payloadJson(), REVIEWER_SUCCESS_PAYLOAD, behavior),
      );
      return 0;
    }
    case 'auth-failure': {
      const message = 'Error: not logged in. Please run the login command.';
      if (provider === 'claude') {
        process.stdout.write(
          `${JSON.stringify({ type: 'result', is_error: true, result: message })}\n`,
        );
      } else {
        process.stderr.write(`${message}\n`);
      }
      return 1;
    }
    case 'banner-then-error': {
      // Shape of a Codex exec failure: a non-fatal ERROR line and the session
      // banner first, the fatal cause last. Text is synthetic, not a real CLI's.
      process.stderr.write(
        [
          '2026-09-30T00:00:00.000000Z ERROR fake_models::cache: failed to load models cache: missing field `base_instructions`',
          `Fake Codex v${behavior.version ?? '0.0.0'}`,
          '--------',
          `workdir: ${process.cwd()}`,
          'model: fake-model',
          'provider: fake',
          'sandbox: read-only',
          '--------',
          ...Array.from({ length: 12 }, (_, index) => `banner detail line ${index + 1}`),
          `FATAL: ${behavior.fatalMessage ?? 'synthetic fatal cause at the end of stderr'}`,
          '',
        ].join('\n'),
      );
      return 1;
    }
    case 'ineligible-account': {
      process.stderr.write(
        'Approval mode overridden to "default" because the current folder is not trusted.\n' +
          'Error authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals.\n',
      );
      return 41;
    }
    case 'model-not-found': {
      process.stderr.write(`Error: model "${behavior.badModel ?? 'x'}" not found (404)\n`);
      return 1;
    }
    case 'error-envelope': {
      // Some CLIs report failures inside a successful (exit 0) JSON envelope.
      process.stdout.write(
        provider === 'claude'
          ? `${JSON.stringify({ type: 'result', is_error: true, result: 'Error: not logged in. Please run login.' })}\n`
          : `${JSON.stringify({ error: { message: 'model "gemini-x" not found (404)' } })}\n`,
      );
      return 0;
    }
    case 'leak-secret': {
      process.stderr.write(`failure with key ${behavior.secret}\n`);
      return 1;
    }
    case 'hang': {
      process.stdout.write('started\n');
      setInterval(() => undefined, 1_000);
      return null;
    }
    case 'spawn-child': {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./fake-cli.mjs', import.meta.url)), '--scenario=hang', '--ignore-sigterm'],
        { stdio: 'ignore', shell: false, windowsHide: true },
      );
      if (behavior.pidFile) writeFileSync(behavior.pidFile, String(child.pid));
      process.on('SIGTERM', () => undefined);
      setInterval(() => undefined, 1_000);
      return null;
    }
    default: {
      process.stderr.write('unknown fake provider behavior\n');
      return 64;
    }
  }
}

export async function main(provider, behavior) {
  const exitCode = await runFakeProvider(provider, behavior);
  if (exitCode !== null) {
    process.exitCode = exitCode;
    process.stdin.destroy();
  }
}
