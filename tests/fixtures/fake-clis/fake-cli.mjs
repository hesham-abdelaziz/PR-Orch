#!/usr/bin/env node
// Deterministic fake AI CLI used by engine tests. It never contacts a network
// and never touches the filesystem except for the optional --pid-file.
//
// Usage: node fake-cli.mjs --scenario=<name> [scenario options] [extra args]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const found = argv.find((argument) => argument.startsWith(prefix));

  return found === undefined ? fallback : found.slice(prefix.length);
}

const scenario = option('scenario', 'success');

export const REVIEWER_SUCCESS_PAYLOAD = {
  findings: [
    {
      title: 'Unchecked null dereference in loader',
      severity: 'high',
      filePath: 'src/loader.ts',
      location: { startLine: 12, endLine: 14 },
      evidence: 'Line 12 reads config.value without checking config for null.',
      impact: 'The loader throws a TypeError for empty configuration files.',
      suggestedFix: 'Guard config before reading value or default it.',
    },
  ],
  warnings: [],
  exclusions: [],
};

function writeAll(stream, text) {
  return new Promise((resolve) => {
    if (stream.write(text)) resolve();
    else stream.once('drain', resolve);
  });
}

async function flood(stream, totalBytes) {
  const chunk = 'x'.repeat(8192);
  let remaining = totalBytes;

  while (remaining > 0) {
    const size = Math.min(remaining, chunk.length);
    await writeAll(stream, chunk.slice(0, size));
    remaining -= size;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);

  return Buffer.concat(chunks).toString('utf8');
}

function keepAlive() {
  return setInterval(() => undefined, 1_000);
}

function maybeIgnoreSigterm() {
  if (argv.includes('--ignore-sigterm')) {
    process.on('SIGTERM', () => undefined);
    process.on('SIGINT', () => undefined);
    process.on('SIGBREAK', () => undefined);
  }
}

async function main() {
  switch (scenario) {
    case 'success': {
      process.stdout.write(`${JSON.stringify(REVIEWER_SUCCESS_PAYLOAD)}\n`);
      return 0;
    }
    case 'stderr': {
      process.stdout.write('stdout-line\n');
      process.stderr.write('stderr-line\n');
      return 0;
    }
    case 'malformed': {
      process.stdout.write('{"findings": [ {"title": "cut off"\n');
      return 0;
    }
    case 'auth-failure': {
      process.stderr.write(
        'Error: not authenticated. Run the provider login command first.\n',
      );
      return 41;
    }
    case 'exit': {
      return Number(option('code', '1'));
    }
    case 'echo-stdin': {
      const stdin = await readStdin();
      process.stdout.write(JSON.stringify({ stdin }));
      return 0;
    }
    case 'print-args': {
      process.stdout.write(JSON.stringify(argv));
      return 0;
    }
    case 'print-env': {
      process.stdout.write(JSON.stringify(process.env));
      return 0;
    }
    case 'ansi': {
      process.stdout.write('\u001B[31mred text\u001B[0m\r\n');
      process.stdout.write('\u001B[2K\rprogress \u001B]0;title\u0007done\n');
      process.stderr.write('\u001B[33mwarn\u001B[0m\n');
      return 0;
    }
    case 'utf8-split': {
      const bytes = Buffer.from('héllo €uro 😀\n', 'utf8');
      for (const byte of bytes) {
        await writeAll(process.stdout, Buffer.from([byte]));
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      return 0;
    }
    case 'utf8-flood': {
      // 3-byte characters so a cap of 1001 bytes lands inside a character.
      await writeAll(process.stdout, '€'.repeat(2_000));
      return 0;
    }
    case 'oversized': {
      const stdoutBytes = Number(option('stdout-bytes', '0'));
      const stderrBytes = Number(option('stderr-bytes', '0'));
      await Promise.all([
        flood(process.stdout, stdoutBytes),
        flood(process.stderr, stderrBytes),
      ]);
      return 0;
    }
    case 'hang': {
      maybeIgnoreSigterm();
      process.stdout.write('hang-started\n');
      keepAlive();
      return null;
    }
    case 'spawn-child': {
      // The grandchild ignores termination signals so only a tree kill ends it.
      const child = spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), '--scenario=hang', '--ignore-sigterm'],
        { stdio: 'ignore', shell: false, windowsHide: true },
      );
      const pidFile = option('pid-file', '');
      if (pidFile) writeFileSync(pidFile, String(child.pid));
      process.stdout.write(`child-pid:${child.pid}\n`);
      maybeIgnoreSigterm();
      process.on('SIGTERM', () => undefined);
      keepAlive();
      return null;
    }
    default: {
      process.stderr.write(`unknown scenario: ${scenario}\n`);
      return 64;
    }
  }
}

const exitCode = await main();
if (exitCode !== null) {
  process.exitCode = exitCode;
  // Do not linger on open handles from stdin readers.
  process.stdin.destroy();
}
