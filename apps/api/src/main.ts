import { createLocalApplication, runtimeOptions } from './bootstrap.js';

let app: Awaited<ReturnType<typeof createLocalApplication>> | undefined;
try {
  const options = runtimeOptions();
  app = await createLocalApplication(options);
  await app.listen(options.port, '127.0.0.1');
  console.info(`PR Review Orchestrator: http://127.0.0.1:${options.port}`);
} catch {
  await app?.close();
  console.error(
    'Local startup failed. Check Node/Git installation, application data access, Windows Credential Manager, and whether the dashboard is already running or its port is occupied.',
  );
  process.exitCode = 1;
}
