import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compareSemver, nextVersion, parseSemver, release } from './release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const created = [];
after(() => created.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const CHANGELOG = `# Changelog

All notable changes to this project are documented here.

## [0.1.0] - 2026-10-01

Initial release.
`;

const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function makeFixture(version = '0.1.0') {
  const root = mkdtempSync(join(tmpdir(), 'release-fixture-'));
  created.push(root);
  mkdirSync(join(root, 'scripts'));
  for (const name of ['release.mjs', 'generate-release-info.mjs']) {
    cpSync(join(here, name), join(root, 'scripts', name));
  }
  for (const dir of ['apps/api', 'apps/web', 'packages/contracts', 'tests/fixtures/other']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeJson(join(root, 'package.json'), {
    name: 'fixture-root',
    version,
    private: true,
    workspaces: ['apps/*', 'packages/*'],
  });
  writeJson(join(root, 'apps/api/package.json'), {
    name: '@fx/api',
    version,
    dependencies: { '@fx/contracts': version, zod: '^4.0.0' },
  });
  writeJson(join(root, 'apps/web/package.json'), {
    name: '@fx/web',
    version,
    dependencies: { '@fx/contracts': version },
    devDependencies: { vitest: '^4.0.0' },
  });
  writeJson(join(root, 'packages/contracts/package.json'), { name: '@fx/contracts', version });
  writeJson(join(root, 'tests/fixtures/other/package.json'), { name: 'unrelated', version: '9.9.9' });
  writeJson(join(root, 'package-lock.json'), {
    name: 'fixture-root',
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture-root', version, workspaces: ['apps/*', 'packages/*'] },
      'apps/api': { name: '@fx/api', version, dependencies: { '@fx/contracts': version, zod: '^4.0.0' } },
      'apps/web': { name: '@fx/web', version, dependencies: { '@fx/contracts': version } },
      'packages/contracts': { name: '@fx/contracts', version },
      'node_modules/@fx/api': { resolved: 'apps/api', link: true },
      'node_modules/zod': { version: '4.0.0' },
    },
  });
  writeFileSync(join(root, 'CHANGELOG.md'), CHANGELOG);
  return root;
}

function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out[full.slice(root.length)] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return out;
}

const runRelease = (root, ...args) =>
  spawnSync(process.execPath, [join(root, 'scripts', 'release.mjs'), ...args], { cwd: root, encoding: 'utf8' });

const readJson = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

describe('release CLI', () => {
  it('bumps patch across every package, lock entry, internal spec, changelog and generated file', () => {
    const root = makeFixture();
    const result = runRelease(root, 'patch', 'Fix a bug');
    assert.equal(result.status, 0, result.stderr);

    for (const file of ['package.json', 'apps/api/package.json', 'apps/web/package.json', 'packages/contracts/package.json']) {
      assert.equal(readJson(root, file).version, '0.1.1', file);
    }
    assert.equal(readJson(root, 'apps/api/package.json').dependencies['@fx/contracts'], '0.1.1');
    assert.equal(readJson(root, 'apps/api/package.json').dependencies.zod, '^4.0.0');
    assert.equal(readJson(root, 'apps/web/package.json').dependencies['@fx/contracts'], '0.1.1');
    assert.equal(readJson(root, 'tests/fixtures/other/package.json').version, '9.9.9');

    const lock = readJson(root, 'package-lock.json');
    assert.equal(lock.version, '0.1.1');
    for (const key of ['', 'apps/api', 'apps/web', 'packages/contracts']) {
      assert.equal(lock.packages[key].version, '0.1.1', key);
    }
    assert.equal(lock.packages['apps/api'].dependencies['@fx/contracts'], '0.1.1');
    assert.equal(lock.packages['apps/web'].dependencies['@fx/contracts'], '0.1.1');
    assert.equal(lock.packages['node_modules/zod'].version, '4.0.0');
    assert.equal(lock.packages['node_modules/@fx/api'].version, undefined);

    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    assert.match(changelog, /## \[0\.1\.1\] - \d{4}-\d{2}-\d{2}\n\nFix a bug\n/);
    assert.ok(changelog.indexOf('[0.1.1]') < changelog.indexOf('[0.1.0]'));
    assert.ok(changelog.startsWith('# Changelog'));

    const generated = readFileSync(join(root, 'apps/web/src/app/release/release-info.generated.ts'), 'utf8');
    assert.match(generated, /export const APP_VERSION: string = "0\.1\.1";/);
    assert.match(generated, /Fix a bug/);
  });

  it('supports minor, major and explicit versions', () => {
    const root = makeFixture('1.2.3');
    assert.equal(runRelease(root, 'minor', 'm').status, 0);
    assert.equal(readJson(root, 'package.json').version, '1.3.0');
    assert.equal(runRelease(root, 'major', 'M').status, 0);
    assert.equal(readJson(root, 'package.json').version, '2.0.0');
    assert.equal(runRelease(root, '2.1.0-beta.1', 'pre').status, 0);
    assert.equal(readJson(root, 'apps/api/package.json').dependencies['@fx/contracts'], '2.1.0-beta.1');
    assert.equal(runRelease(root, '2.1.0', 'final').status, 0);
    assert.equal(readJson(root, 'package-lock.json').packages['packages/contracts'].version, '2.1.0');
  });

  const rejected = [
    ['invalid version', ['not-a-version', 'x']],
    ['leading zeros', ['01.2.3', 'x']],
    ['equal version', ['0.1.0', 'x']],
    ['lower version', ['0.0.9', 'x']],
    ['lower prerelease of current', ['0.1.0-rc.1', 'x']],
    ['missing summary', ['patch']],
    ['blank summary', ['patch', '   ']],
    ['no arguments', []],
    ['extra arguments', ['patch', 'x', 'y']],
    ['shell metacharacters as version', ['patch; echo hacked', 'x']],
  ];
  for (const [name, args] of rejected) {
    it(`rejects ${name} without writing`, () => {
      const root = makeFixture();
      const before = snapshot(root);
      const result = runRelease(root, ...args);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.length > 0);
      assert.deepEqual(snapshot(root), before);
    });
  }

  it('rejects out-of-sync workspace versions without writing', () => {
    const root = makeFixture();
    writeJson(join(root, 'apps/web/package.json'), { name: '@fx/web', version: '0.0.5' });
    const before = snapshot(root);
    assert.notEqual(runRelease(root, 'patch', 'x').status, 0);
    assert.deepEqual(snapshot(root), before);
  });

  it('rejects when changelog already has the target version without writing', () => {
    const root = makeFixture();
    writeFileSync(join(root, 'CHANGELOG.md'), `${CHANGELOG}\n## [0.1.1] - 2026-10-02\n\nx\n`);
    const before = snapshot(root);
    assert.notEqual(runRelease(root, 'patch', 'x').status, 0);
    assert.deepEqual(snapshot(root), before);
  });

  it('keeps summaries literal (no shell interpolation)', () => {
    const root = makeFixture();
    const summary = 'Uses "quotes", $HOME, `ticks` & $(whoami)';
    assert.equal(runRelease(root, 'patch', summary).status, 0);
    assert.ok(readFileSync(join(root, 'CHANGELOG.md'), 'utf8').includes(summary));
  });
});

describe('generate-release-info', () => {
  it('exports JSON-escaped APP_VERSION and APP_CHANGELOG that round-trip', async () => {
    const root = makeFixture();
    const changelog = '# Changelog\n\n## [0.1.0] - 2026-10-01\n\nQuote " backslash \\ ${x} `tick`   end\n';
    writeFileSync(join(root, 'CHANGELOG.md'), changelog);
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'generate-release-info.mjs')], {
      cwd: join(root, 'apps/web'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const file = join(root, 'apps/web/src/app/release/release-info.generated.ts');
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes(' '));
    const jsFile = join(root, 'check.mjs');
    writeFileSync(jsFile, source.replace(/: string/g, ''));
    const mod = await import(pathToFileURL(jsFile).href);
    assert.equal(mod.APP_VERSION, '0.1.0');
    assert.equal(mod.APP_CHANGELOG, changelog);
  });

  it('is deterministic', () => {
    const root = makeFixture();
    const run = () => spawnSync(process.execPath, [join(root, 'scripts', 'generate-release-info.mjs')], { encoding: 'utf8' });
    assert.equal(run().status, 0);
    const first = snapshot(root);
    assert.equal(run().status, 0);
    assert.deepEqual(snapshot(root), first);
  });
});

describe('SemVer handling', () => {
  it('accepts build metadata and ignores it for precedence', () => {
    assert.doesNotThrow(() => parseSemver('1.2.3+build.1'));
    assert.doesNotThrow(() => parseSemver('1.2.3-rc.1+build-5.x'));
    assert.equal(compareSemver('1.2.3+a', '1.2.3+b'), 0);
    assert.equal(compareSemver('1.2.4+a', '1.2.3+z'), 1);
    for (const bad of ['1.2.3+', '1.2.3+a..b', '1.2.3+a_b', '1.2.3+build+x']) {
      assert.throws(() => parseSemver(bad), /Invalid SemVer/, bad);
    }
  });

  it('compares large numeric identifiers exactly', () => {
    assert.equal(compareSemver('1.0.0-alpha.9007199254740993', '1.0.0-alpha.9007199254740992'), 1);
    assert.equal(compareSemver('1.0.0-alpha.9007199254740992', '1.0.0-alpha.9007199254740993'), -1);
    assert.equal(compareSemver('1.0.0-alpha.99999999999999999999', '1.0.0-alpha.99999999999999999999'), 0);
  });

  it('orders numeric prereleases by value and below nonnumeric identifiers', () => {
    assert.equal(compareSemver('1.0.0-rc.2', '1.0.0-rc.10'), -1);
    assert.equal(compareSemver('1.0.0-rc.10', '1.0.0-rc.9'), 1);
    assert.equal(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
    assert.equal(compareSemver('1.0.0-alpha.beta', '1.0.0-alpha.1'), 1);
  });

  it('allows increasing numeric prereleases and rejects a downgrade without writes', () => {
    const root = makeFixture('1.0.0-rc.9');
    assert.equal(runRelease(root, '1.0.0-rc.10', 'Next candidate').status, 0);
    const before = snapshot(root);
    assert.notEqual(runRelease(root, '1.0.0-rc.9', 'Older candidate').status, 0);
    assert.deepEqual(snapshot(root), before);
  });

  it('rejects unsafe core integers clearly', () => {
    assert.throws(() => parseSemver('9007199254740992.0.0'), /safe integer/);
    assert.throws(() => parseSemver('1.0.99999999999999999999'), /safe integer/);
    assert.doesNotThrow(() => parseSemver('9007199254740991.0.0'));
    assert.throws(() => nextVersion('1.0.9007199254740991', 'patch'), /safe integer/);
  });

  it('CLI accepts build metadata only for a strictly increasing version', () => {
    const root = makeFixture();
    const before = snapshot(root);
    const same = runRelease(root, '0.1.0+build.1', 'x');
    assert.notEqual(same.status, 0);
    assert.match(same.stderr, /greater/);
    assert.deepEqual(snapshot(root), before);

    assert.equal(runRelease(root, '0.1.1+build.1', 'Build release').status, 0);
    assert.equal(readJson(root, 'package.json').version, '0.1.1+build.1');
    assert.equal(readJson(root, 'apps/api/package.json').dependencies['@fx/contracts'], '0.1.1+build.1');
    assert.ok(readFileSync(join(root, 'CHANGELOG.md'), 'utf8').includes('## [0.1.1+build.1] - '));
    // Same precedence as current (build metadata differs only) is rejected.
    assert.notEqual(runRelease(root, '0.1.1+other', 'x').status, 0);
    assert.equal(runRelease(root, 'patch', 'next').status, 0);
    assert.equal(readJson(root, 'package.json').version, '0.1.2');
  });

  it('rejects unsafe core integers via CLI without writing', () => {
    const root = makeFixture();
    const before = snapshot(root);
    const result = runRelease(root, '9007199254740993.0.0', 'x');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /safe integer/);
    assert.deepEqual(snapshot(root), before);
  });
});

describe('release atomicity', () => {
  it('leaves everything unchanged when the generated file cannot be staged', () => {
    const root = makeFixture();
    mkdirSync(join(root, 'apps/web/src/app'), { recursive: true });
    writeFileSync(join(root, 'apps/web/src/app/release'), 'i am a file, not a directory');
    const before = snapshot(root);
    const result = runRelease(root, 'patch', 'x');
    assert.notEqual(result.status, 0);
    assert.deepEqual(snapshot(root), before);
  });

  it('rolls back committed files and removes temp files when a commit rename fails', () => {
    const root = makeFixture();
    const before = snapshot(root);
    const realRename = fs.renameSync;
    let calls = 0;
    const failingFs = {
      ...fs,
      renameSync: (from, to) => {
        if (++calls === 4) throw new Error('simulated rename failure');
        return realRename(from, to);
      },
    };
    assert.throws(() => release({ root, request: 'patch', summary: 'x', fs: failingFs }), /simulated rename failure/);
    assert.deepEqual(snapshot(root), before);
  });

  it('removes a generated directory it created when rolling back', () => {
    const root = makeFixture();
    const before = snapshot(root);
    const realRename = fs.renameSync;
    const failingFs = {
      ...fs,
      renameSync: (from, to) => {
        if (to.endsWith('release-info.generated.ts')) throw new Error('simulated rename failure');
        return realRename(from, to);
      },
    };
    assert.throws(() => release({ root, request: 'patch', summary: 'x', fs: failingFs }), /simulated/);
    assert.deepEqual(snapshot(root), before);
    assert.equal(fs.existsSync(join(root, 'apps/web/src')), false);
  });
});
