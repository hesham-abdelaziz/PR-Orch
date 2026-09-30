import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';

/** Kernel-held, crash-released mutex. Never store a PID which could be recycled. */
export async function acquireRuntimeLease(
  dataRoot: string,
): Promise<() => Promise<void>> {
  await mkdir(dataRoot, { recursive: true });
  const canonical = await realpath(dataRoot);
  const hash = createHash('sha256')
    .update(process.platform === 'win32' ? canonical.toLowerCase() : canonical)
    .digest('hex');
  // Windows is the supported deployment target; Linux abstract sockets also
  // release automatically on crash without stale lock-file deletion races.
  if (!['win32', 'linux'].includes(process.platform))
    throw new Error('Local application locking supports Windows and Linux');
  const address =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\pr-review-orchestrator-${hash}`
      : `\0pr-review-orchestrator-${hash}`;
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', () =>
      reject(
        new Error(
          'The dashboard is already running for this application data directory, or its runtime lock is unavailable.',
        ),
      ),
    );
    server.listen(address, resolve);
  });
  server.unref();
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
}
