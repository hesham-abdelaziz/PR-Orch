# PR-Orch

Local PR Review Orchestrator with an Angular dashboard, API, and shared contracts.

## Run locally on Windows

Prerequisites: Node.js 24.15 or newer, npm, and Git for Windows available on
`PATH`. The current credential storage uses Windows Credential Manager.

Open PowerShell and run these commands for a new checkout:

```powershell
git clone --branch main https://github.com/hesham-abdelaziz/PR-Orch.git
Set-Location .\PR-Orch
node --version
git --version
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3000** in your browser. Keep the terminal open while
using the dashboard. Press **Ctrl+C** in that terminal to stop it.

`npm run build` builds the shared contracts, backend, and frontend in order.
`npm start` runs the backend and serves the built Angular frontend from the same
checkout; one command starts the complete dashboard.

On first use, create the local account in the dashboard. Before running reviews,
install and authenticate the provider CLIs you intend to use (Claude Code,
Codex, or Gemini), then configure Azure authentication and review defaults in
Settings.

### Start again or update an existing checkout

Run these commands from your existing PR-Orch repository folder after stopping
the application:

```powershell
git switch main
git pull --ff-only
npm ci
npm run build
npm start
```

If you have already installed and built that revision, start it with just:

```powershell
npm start
```

### Optional port and data location

The default port is `3000`. To use another port in the current PowerShell session:

```powershell
$env:PORT = '3001'
npm start
```

Then open **http://127.0.0.1:3001**. To return to the default port:

```powershell
Remove-Item Env:PORT -ErrorAction SilentlyContinue
```

Application data defaults to `%LOCALAPPDATA%\pr-review-orchestrator` and remains
outside the repository. If you already use `PR_ORCHESTRATOR_DATA_ROOT`, keep its
existing value to retain access to your settings and review history. An optional
custom location must be an absolute path:

```powershell
$env:PR_ORCHESTRATOR_DATA_ROOT = 'C:\PR-Orch-data'
npm start
```

### Run checks without starting the dashboard

```powershell
npm run build
npm test
```

The `main` branch is the committed integration baseline. Ongoing work on other
branches is included only after it has been integrated and committed to `main`.
