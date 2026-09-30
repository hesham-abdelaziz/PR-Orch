import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import {
  createLocalApplication,
  runtimeOptions,
} from "../apps/api/dist/bootstrap.js";

// Actual compiled startup, real Windows Credential Manager read and SQLite.
// No account/secret changes, Azure requests, or model invocations.
const root = await mkdtemp(join(tmpdir(), "pr-orchestrator-smoke-"));
let app;
try {
  const options = runtimeOptions({
    ...process.env,
    PR_ORCHESTRATOR_DATA_ROOT: root,
  });
  app = await createLocalApplication(options);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  const base = `http://127.0.0.1:${address.port}`;
  const session = await (await fetch(`${base}/api/auth/session`)).json();
  const unauthenticated = await fetch(`${base}/api/settings`);
  const spa = await fetch(base);
  if (
    address.address !== "127.0.0.1" ||
    session.authenticated !== false ||
    session.setupRequired !== true ||
    unauthenticated.status !== 401 ||
    spa.status !== 200
  )
    throw new Error(
      `Local backend smoke assertions failed: ${JSON.stringify({ loopback: address.address === "127.0.0.1", sessionStatus: session.authenticated, setupRequired: session.setupRequired, protectedStatus: unauthenticated.status, webStatus: spa.status })}`,
    );
  console.info(
    JSON.stringify({
      loopback: true,
      migrations: true,
      setupRequired: true,
      protectedApi: true,
      sameOriginWeb: true,
    }),
  );
} finally {
  await app?.close();
  const withinTemp = relative(tmpdir(), root);
  if (
    !withinTemp.startsWith("pr-orchestrator-smoke-") ||
    withinTemp.includes("..") ||
    isAbsolute(withinTemp)
  )
    throw new Error("Unsafe smoke cleanup path");
  await rm(root, { recursive: true, force: true });
}
