# Application release versioning coordination

User authorized Claude Code and Antigravity to edit files and asked Codex to complete and verify the feature. Scope: application release version in dashboard, changelog, and release bumps.

Design: root package.json is the source of truth; initial release 0.1.0. Workspace package versions and internal workspace dependency versions remain synchronized. CHANGELOG.md holds dated release notes. A local release command accepts patch/minor/major or an explicit valid SemVer plus a required release summary, updates versions/lockfile/changelog, and regenerates frontend release metadata without committing/tagging/publishing. Builds regenerate metadata so the UI corresponds to the version being built.

Frontend interface agreed between agents: apps/web/src/app/release/release-info.generated.ts exports APP_VERSION (string) and APP_CHANGELOG (Markdown string). Claude owns this generated file and its generation. Antigravity imports these exports, displays the version in the dashboard shell, and adds a release notes route using the existing safe Markdown component.

Ownership: Claude owns scripts/, package.json, package-lock.json, all workspace package.json files, CHANGELOG.md, README.md, and release-info.generated.ts. Antigravity owns frontend source except release-info.generated.ts. Codex coordinates, reviews and fixes integration gaps. Preserve all pre-existing untracked handoff files. Do not commit, push, publish or modify user data. Tests must demonstrate release updates, rejection of invalid versions/arguments without modifications, and UI version/release notes behavior.
