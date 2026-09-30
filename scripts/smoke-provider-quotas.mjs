// Non-billable probe. No threads, turns, login, credential files or Azure calls.
import { tmpdir } from "node:os";
import { WindowsCliResolver } from "../apps/api/dist/providers/windows-cli-resolver.js";
import { ProcessSupervisor } from "../apps/api/dist/providers/process/process-supervisor.service.js";
import { buildChildEnvironment } from "../apps/api/dist/providers/process/environment-policy.js";
import { readCodexQuotaProcess } from "../apps/api/dist/platform/quota/codex-process.js";
const resolver = new WindowsCliResolver();
const supervisor = new ProcessSupervisor();
const report = { providers: {}, codexQuota: null };
for (const provider of ["claude", "codex", "gemini"]) {
  const command = resolver.locate(provider);
  if (!command) {
    report.providers[provider] = { installed: false };
    continue;
  }
  const probe = async (args) =>
    supervisor.run({
      runId: `quota-probe-${provider}-${args.join("-")}`,
      executablePath: command.executablePath,
      args: [...command.prefixArgs, ...args],
      cwd: tmpdir(),
      stdin: "",
      environment: buildChildEnvironment({ parent: process.env, provider }),
      signal: new AbortController().signal,
      timeoutMs: 15000,
      maxStdoutBytes: 131072,
      maxStderrBytes: 16384,
    });
  const version = await probe(["--version"]);
  const help = await probe(["--help"]);
  const item = {
    installed: true,
    version:
      /\d+\.\d+\.\d+/.exec(version.stdout + version.stderr)?.[0] ??
      "unavailable",
    helpSucceeded: help.status === "completed",
    machineReadableQuotaCommandListed: /^\s+(quota|usage)\s/m.test(help.stdout),
  };
  if (provider === "claude") {
    const auth = await probe(["auth", "status"]);
    try {
      item.authenticated = JSON.parse(auth.stdout).loggedIn === true;
    } catch {
      item.authenticated = null;
    }
  }
  report.providers[provider] = item;
  if (provider === "codex") {
    const appHelp = await probe(["app-server", "--help"]);
    item.appServerStdio =
      appHelp.status === "completed" && appHelp.stdout.includes("stdio://");
    report.codexQuota = await readCodexQuotaProcess(
      command,
      new AbortController().signal,
    );
  }
}
console.log(JSON.stringify(report, null, 2));
if (
  Object.values(report.providers).some((p) => !p.installed || !p.helpSucceeded)
)
  process.exitCode = 1;
