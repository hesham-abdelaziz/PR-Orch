import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const scenario = process.argv[2];
let initialized = false;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    if (scenario === 'tree') {
      const child = spawn(
        process.execPath,
        ['-e', 'setInterval(()=>{},1000)'],
        { stdio: 'ignore', windowsHide: true },
      );
      writeFileSync(process.argv[3], String(child.pid));
    }
    if (
      scenario === 'env' &&
      (process.env.AZURE_DEVOPS_PAT ||
        process.env.GEMINI_API_KEY ||
        process.env.NODE_OPTIONS ||
        process.env.OPENAI_API_KEY !== 'synthetic-openai-key')
    )
      process.exit(14);
    send({ id: request.id, result: {} });
    return;
  }
  if (request.method === 'initialized') {
    initialized = true;
    return;
  }
  if (
    !initialized ||
    !['account/read', 'account/rateLimits/read'].includes(request.method)
  )
    process.exit(12);
  if (scenario === 'hang' || scenario === 'tree') return;
  if (scenario === 'exit') process.exit(0);
  if (scenario === 'malformed') {
    process.stdout.write('private-secret-not-json\n');
    return;
  }
  if (scenario === 'flood') {
    process.stdout.write('x'.repeat(300000));
    return;
  }
  if (scenario === 'stderr') {
    process.stderr.write('private-secret'.repeat(3000));
    return;
  }
  if (request.method === 'account/read') {
    if (request.params.refreshToken !== false) process.exit(13);
    if (scenario === 'noauth') {
      send({ id: request.id, result: { account: null } });
      return;
    }
    send({
      id: request.id,
      result: {
        account: {
          type: scenario === 'apikey' ? 'apiKey' : 'chatgpt',
          email: 'private@example.com',
        },
      },
    });
    return;
  }
  if (scenario === 'unsupported') {
    send({
      id: request.id,
      error: { code: -32601, message: 'private-secret' },
    });
    return;
  }
  if (scenario === 'error') {
    send({
      id: request.id,
      error: { code: -32603, message: 'private-secret' },
    });
    return;
  }
  send({
    id: request.id,
    result: {
      accountId: 'private-secret',
      rateLimits: {
        primary: { usedPercent: 25, windowDurationMins: 300 },
        secondary: { usedPercent: 50, windowDurationMins: 10080 },
      },
    },
  });
});
