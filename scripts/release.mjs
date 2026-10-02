import * as nodeFs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_INFO_PATH, renderReleaseInfo } from './generate-release-info.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { existsSync, readFileSync, readdirSync } = nodeFs;

const IDENT = '(?:0|[1-9]\\d*)';
const PRE_ID = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
const SEMVER = new RegExp(`^(${IDENT})\\.(${IDENT})\\.(${IDENT})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`);

export function parseSemver(text) {
  const match = typeof text === 'string' ? SEMVER.exec(text) : null;
  if (!match) throw new Error(`Invalid SemVer version: ${JSON.stringify(text)}`);
  const core = match.slice(1, 4).map(BigInt);
  if (core.some((n) => n > BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error(`Version ${text} has a core number above the maximum safe integer (${Number.MAX_SAFE_INTEGER}).`);
  }
  // Build metadata (match[5]) is valid but has no effect on precedence.
  return { core, pre: match[4] ? match[4].split('.') : [] };
}

export function compareSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const l = x.pre[i];
    const r = y.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l);
    const rn = /^\d+$/.test(r);
    if (ln && rn) return BigInt(l) < BigInt(r) ? -1 : 1;
    if (ln !== rn) return ln ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

export function nextVersion(current, request) {
  const [major, minor, patch] = parseSemver(current).core;
  const next =
    request === 'major' ? `${major + 1n}.0.0` :
    request === 'minor' ? `${major}.${minor + 1n}.0` :
    request === 'patch' ? `${major}.${minor}.${patch + 1n}` :
    request;
  parseSemver(next);
  return next;
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

function workspaceDirs(root, patterns) {
  const dirs = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      const baseDir = join(root, base);
      if (!existsSync(baseDir)) continue;
      for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (entry.isDirectory() && existsSync(join(baseDir, entry.name, 'package.json'))) {
          dirs.push(`${base}/${entry.name}`);
        }
      }
    } else if (existsSync(join(root, pattern, 'package.json'))) {
      dirs.push(pattern);
    } else {
      throw new Error(`Unsupported or missing workspace pattern: ${pattern}`);
    }
  }
  return dirs;
}

function syncDeps(manifest, names, version) {
  for (const field of DEP_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (names.has(name)) manifest[field][name] = version;
    }
  }
}

function addChangelogEntry(text, version, date, summary) {
  const heading = new RegExp(`^## \\[${version.replace(/[.+-]/g, '\\$&')}\\]`, 'm');
  if (heading.test(text)) throw new Error(`CHANGELOG.md already contains version ${version}.`);
  const entry = `## [${version}] - ${date}\n\n${summary}\n`;
  const first = text.search(/^## \[/m);
  if (first === -1) return `${text.replace(/\s*$/, '')}\n\n${entry}`;
  return `${text.slice(0, first)}${entry}\n${text.slice(first)}`;
}

function applyOutputs(outputs, fs) {
  const originals = new Map(outputs.map(([path]) => [path, fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null]));
  const tmp = (path) => `${path}.release-tmp`;
  const committed = [];
  let createdDir;
  const problems = [];
  const attempt = (action) => {
    try {
      action();
    } catch (error) {
      problems.push(error.message);
    }
  };
  try {
    for (const [path, content] of outputs) {
      createdDir ??= fs.mkdirSync(dirname(path), { recursive: true });
      fs.writeFileSync(tmp(path), content);
    }
    for (const [path] of outputs) {
      fs.renameSync(tmp(path), path);
      committed.push(path);
    }
  } catch (error) {
    for (const [path] of outputs) attempt(() => fs.rmSync(tmp(path), { force: true }));
    for (const path of committed) {
      const original = originals.get(path);
      attempt(() => (original === null ? fs.rmSync(path, { force: true }) : fs.writeFileSync(path, original)));
    }
    if (createdDir) attempt(() => fs.rmSync(createdDir, { recursive: true, force: true }));
    if (problems.length) {
      error.message += ` Rollback was incomplete (${problems.join('; ')}); restore files from version control.`;
    }
    throw error;
  }
}

export function release({ root = defaultRoot, request, summary, date = new Date(), fs = nodeFs }) {
  if (typeof summary !== 'string' || summary.trim() === '') {
    throw new Error('A non-empty release summary is required.');
  }
  summary = summary.trim().replace(/\r\n/g, '\n');
  const isoDate = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((n, i) => String(n).padStart(i ? 2 : 4, '0'))
    .join('-');

  const rootPath = join(root, 'package.json');
  const rootPkg = readJson(rootPath);
  const current = rootPkg.version;
  parseSemver(current);
  const version = nextVersion(current, request);
  if (compareSemver(version, current) <= 0) {
    throw new Error(`New version ${version} must be greater than current version ${current}.`);
  }

  const dirs = workspaceDirs(root, rootPkg.workspaces ?? []);
  const manifests = dirs.map((dir) => ({ dir, path: join(root, dir, 'package.json'), pkg: readJson(join(root, dir, 'package.json')) }));
  for (const { dir, pkg } of manifests) {
    if (pkg.version !== current) {
      throw new Error(`Workspace ${dir} is at ${pkg.version}, expected ${current}. Synchronize versions first.`);
    }
  }
  const names = new Set(manifests.map(({ pkg }) => pkg.name));

  const writes = [];
  rootPkg.version = version;
  syncDeps(rootPkg, names, version);
  writes.push([rootPath, rootPkg]);
  for (const m of manifests) {
    m.pkg.version = version;
    syncDeps(m.pkg, names, version);
    writes.push([m.path, m.pkg]);
  }

  const lockPath = join(root, 'package-lock.json');
  if (existsSync(lockPath)) {
    const lock = readJson(lockPath);
    lock.version = version;
    for (const key of ['', ...dirs]) {
      const entry = lock.packages?.[key];
      if (!entry) throw new Error(`package-lock.json is missing entry "${key}".`);
      entry.version = version;
      syncDeps(entry, names, version);
    }
    writes.push([lockPath, lock]);
  }

  const changelogPath = join(root, 'CHANGELOG.md');
  const changelog = addChangelogEntry(readFileSync(changelogPath, 'utf8'), version, isoDate, summary);

  // All validation passed. Stage every output (including the generated file) as temp files,
  // then rename them into place; if staging or any rename fails, restore the originals.
  const outputs = [
    ...writes.map(([path, json]) => [path, `${JSON.stringify(json, null, 2)}
`]),
    [changelogPath, changelog],
    [join(root, RELEASE_INFO_PATH), renderReleaseInfo(version, changelog)],
  ];
  applyOutputs(outputs, fs);
  return { previous: current, version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2) {
      throw new Error('Usage: npm run release -- <patch|minor|major|x.y.z> "<summary>"');
    }
    const { previous, version } = release({ request: args[0], summary: args[1] });
    console.log(`Release ${previous} -> ${version}. Review changes; nothing was committed or tagged.`);
  } catch (error) {
    console.error(`release: ${error.message}`);
    process.exitCode = 1;
  }
}
