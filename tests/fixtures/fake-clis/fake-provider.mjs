// Deterministic stand-ins for the claude, codex, and gemini executables.
// A generated wrapper script imports runFakeProvider with baked-in behavior,
// so tests never depend on environment variables that the engine filters out.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { REVIEWER_SUCCESS_PAYLOAD } from './fake-cli.mjs';

const DEFAULT_HELP = {
  claude: 'Usage: claude [options] [prompt]\n',
  codex:
    'Usage: codex [OPTIONS] [PROMPT]\n  -a, --ask-for-approval <POLICY>\n  -s, --sandbox <MODE>\n',
  'codex-exec':
    'Usage: codex exec [OPTIONS] [PROMPT]\n  -s, --sandbox <MODE>\n  --ephemeral\n  --output-schema <FILE>\n  -C, --cd <DIR>\n',
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

  // Anything else is a review run: record exactly what the engine sent.
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

  switch (behavior.run ?? 'success') {
    case 'success': {
      process.stdout.write(
        `${envelope(provider, payloadJson(), REVIEWER_SUCCESS_PAYLOAD)}\n`,
      );
      return 0;
    }
    case 'malformed': {
      process.stdout.write(`${envelope(provider, '{"findings": [ {"title": "cut')}\n`);
      return 0;
    }
    case 'malformed-once': {
      process.stdout.write(
        invocation === 1
          ? `${envelope(provider, 'Sure! Here you go: {oops')}\n`
          : `${envelope(provider, payloadJson(), REVIEWER_SUCCESS_PAYLOAD)}\n`,
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
