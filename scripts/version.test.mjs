import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KEEL_VERSION,
  parseEngineVersion,
  compareVersions,
  vendoredState,
  vendoredWarnings,
  manifestWarning,
} from './keel.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), 'keel.mjs');
const ENGINE_SOURCE = readFileSync(ENGINE, 'utf8');

describe('parseEngineVersion — reading a version out of a copy of the engine', () => {
  test('reads the declaration this engine actually carries', () => {
    assert.equal(parseEngineVersion(ENGINE_SOURCE), KEEL_VERSION);
  });

  test('tolerates either quote style and surrounding whitespace', () => {
    assert.equal(parseEngineVersion(`export const KEEL_VERSION = '1.2.3';`), '1.2.3');
    assert.equal(parseEngineVersion(`export const KEEL_VERSION="1.2.3";`), '1.2.3');
    assert.equal(parseEngineVersion(`const KEEL_VERSION   =   "0.9.0" ;`), '0.9.0');
  });

  test('a file declaring no version reads as unknown rather than throwing', () => {
    // Every vendored copy predating this feature is exactly this file.
    assert.equal(parseEngineVersion('// keel\nconst STATUS = {};\n'), null);
    assert.equal(parseEngineVersion(''), null);
    assert.equal(parseEngineVersion(undefined), null);
  });
});

describe('compareVersions', () => {
  test('orders by numeric component, not lexically', () => {
    assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
    assert.equal(compareVersions('0.10.0', '0.2.0'), 1);
    assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  });

  test('a missing component counts as zero', () => {
    assert.equal(compareVersions('1', '1.0.0'), 0);
    assert.equal(compareVersions('1.0.1', '1'), 1);
  });
});

describe('vendoredState — what the copy in .keel is', () => {
  const running = { runningVersion: '0.3.0', runningSource: 'export const KEEL_VERSION = "0.3.0";\n// body\n' };

  test('no vendored copy at all is its own state, not a problem', () => {
    assert.equal(vendoredState({ ...running, vendoredSource: null }).state, 'none');
  });

  test('a byte-identical copy is current — this is also the engine running as the vendored copy', () => {
    assert.equal(vendoredState({ ...running, vendoredSource: running.runningSource }).state, 'same');
  });

  test('an older declared version is behind', () => {
    const older = vendoredState({ ...running, vendoredSource: 'export const KEEL_VERSION = "0.2.0";\n' });
    assert.equal(older.state, 'behind');
    assert.equal(older.vendoredVersion, '0.2.0');
  });

  test('a copy declaring no version is behind, because versioning postdates it', () => {
    const pre = vendoredState({ ...running, vendoredSource: '// keel, 0.2.0 era\n' });
    assert.equal(pre.state, 'behind');
    assert.equal(pre.vendoredVersion, null);
  });

  test('the same version with different bytes is a fork, not a match', () => {
    const forked = vendoredState({
      ...running,
      vendoredSource: 'export const KEEL_VERSION = "0.3.0";\n// body, with somebody\'s local fix\n',
    });
    assert.equal(forked.state, 'forked');
  });

  test('the engine running as the vendored copy is its own state, not a match', () => {
    // Comparing a file against itself is not evidence, and this is the command an
    // operator in a consuming repo reaches for first.
    const state = vendoredState({ ...running, vendoredSource: running.runningSource, runningIsVendored: true });
    assert.equal(state.state, 'self');
  });

  test('a newer vendored copy means the plugin is the stale one', () => {
    assert.equal(vendoredState({ ...running, vendoredSource: 'export const KEEL_VERSION = "0.4.0";\n' }).state, 'ahead');
  });
});

describe('vendoredWarnings — what doctor says about it', () => {
  const running = { runningVersion: '0.3.0', runningSource: 'export const KEEL_VERSION = "0.3.0";\n// body\n' };
  const only = (vendoredSource) => {
    const warnings = vendoredWarnings({ ...running, vendoredSource });
    assert.equal(warnings.length, 1, `expected exactly one warning, got ${warnings.length}`);
    return warnings[0];
  };

  test('says nothing at all when there is no vendored copy — vendoring is for CI, not mandatory', () => {
    assert.deepEqual(vendoredWarnings({ ...running, vendoredSource: null }), []);
  });

  test('says nothing when the copy is current', () => {
    assert.deepEqual(vendoredWarnings({ ...running, vendoredSource: running.runningSource }), []);
  });

  test('a stale copy is named with both versions and the way out', () => {
    const warning = only('export const KEEL_VERSION = "0.2.0";\n');
    assert.match(warning, /0\.2\.0/);
    assert.match(warning, /0\.3\.0/);
    assert.match(warning, /keel:update/);
  });

  test('a copy predating versioning says so rather than printing null', () => {
    const warning = only('// keel\n');
    assert.doesNotMatch(warning, /null|undefined/);
    assert.match(warning, /0\.3\.0/);
  });

  test('a fork is called a fork, and names the hazard rather than only the fact', () => {
    const warning = only('export const KEEL_VERSION = "0.3.0";\n// local fix\n');
    assert.match(warning, /hand|edited|fork/i);
  });

  test('says nothing when it is itself the vendored copy — it cannot see the plugin', () => {
    assert.deepEqual(
      vendoredWarnings({ ...running, vendoredSource: running.runningSource, runningIsVendored: true }),
      [],
    );
  });

  test('a newer vendored copy points at the plugin, not at the repo', () => {
    const warning = only('export const KEEL_VERSION = "0.4.0";\n');
    assert.match(warning, /plugin/i);
  });
});

describe('manifestWarning — the release chore now spans two files', () => {
  test('agreeing versions warn about nothing', () => {
    assert.equal(manifestWarning({ engineVersion: '0.3.0', manifestVersion: '0.3.0' }), null);
  });

  test('no manifest beside the engine warns about nothing — a vendored copy has none', () => {
    assert.equal(manifestWarning({ engineVersion: '0.3.0', manifestVersion: null }), null);
  });

  test('disagreeing versions name both, because a wrong one makes every staleness report a lie', () => {
    const warning = manifestWarning({ engineVersion: '0.3.0', manifestVersion: '0.2.0' });
    assert.match(warning, /0\.3\.0/);
    assert.match(warning, /0\.2\.0/);
  });
});

describe('the version command, and doctor, as the CLI actually runs them', () => {
  let repo;
  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'keel-version-repo-'));
    mkdirSync(join(repo, '.keel'), { recursive: true });
    mkdirSync(join(repo, 'contracts'), { recursive: true });
    writeFileSync(
      join(repo, '.keel', 'config.json'),
      JSON.stringify({ contracts: 'contracts', commands: { test: 'true', lint: 'true' }, review: { model: 'x' } }),
    );
    // A structurally healthy install, so an exit code of 0 means what it says: the
    // only thing these tests can push it off is the vendored copy.
    writeFileSync(
      join(repo, 'MENTAL_MODEL.md'),
      [
        '## 1. What this system is for', '## 2. Vocabulary', '## 3. Invariants',
        '## 4. The shape', '## 5. Decisions', '## 6. Sharp edges',
        '## 7. What this system deliberately does not do',
      ].join('\n\ntext\n\n'),
    );
    writeFileSync(join(repo, 'CLAUDE.md'), '@MENTAL_MODEL.md\n');
  });
  after(() => rmSync(repo, { recursive: true, force: true }));

  const run = (...args) => {
    const result = spawnSync('node', [ENGINE, ...args], { cwd: repo, encoding: 'utf8' });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };
  const vendor = (source) => writeFileSync(join(repo, '.keel', 'keel.mjs'), source);
  const unvendor = () => rmSync(join(repo, '.keel', 'keel.mjs'), { force: true });

  test('version prints the running version and where it runs from', () => {
    unvendor();
    const { status, out } = run('version');
    assert.equal(status, 0);
    assert.match(out, new RegExp(KEEL_VERSION.replace(/\./g, '\\.')));
    assert.match(out, /keel\.mjs/);
  });

  test('version reports the vendored copy alongside it', () => {
    vendor('export const KEEL_VERSION = "0.0.1";\n');
    const { out } = run('version');
    assert.match(out, /0\.0\.1/);
    assert.match(out, /behind/i);
  });

  test('version --json gives CI something to branch on', () => {
    vendor('export const KEEL_VERSION = "0.0.1";\n');
    const { out } = run('version', '--json');
    const report = JSON.parse(out);
    assert.equal(report.running, KEEL_VERSION);
    assert.equal(report.vendored, '0.0.1');
    assert.equal(report.state, 'behind');
  });

  test('run as the vendored copy, version refuses to call itself current', () => {
    // The regression this replaced: a copy two versions behind printed "current",
    // because it was comparing itself against itself.
    writeFileSync(join(repo, '.keel', 'keel.mjs'), readFileSync(ENGINE, 'utf8'));
    const result = spawnSync('node', [join(repo, '.keel', 'keel.mjs'), 'version'], { cwd: repo, encoding: 'utf8' });
    const out = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0);
    assert.doesNotMatch(out, /current/);
    assert.match(out, /vendored copy/i);
    assert.match(out, /scripts\/keel\.mjs/, 'it must name the command that can actually compare');
  });

  test('run as the vendored copy, --json reports the state rather than a comparison', () => {
    writeFileSync(join(repo, '.keel', 'keel.mjs'), readFileSync(ENGINE, 'utf8'));
    const result = spawnSync('node', [join(repo, '.keel', 'keel.mjs'), 'version', '--json'], { cwd: repo, encoding: 'utf8' });
    assert.equal(JSON.parse(result.stdout).state, 'self');
  });

  test('doctor warns about the stale copy without failing the install', () => {
    vendor('export const KEEL_VERSION = "0.0.1";\n');
    const { status, out } = run('doctor');
    assert.match(out, /warn.*0\.0\.1/);
    assert.equal(status, 0, 'a stale vendored copy is debt to schedule, not a broken install');
  });

  test('doctor run AS the vendored copy says nothing about it', () => {
    // It is reading itself: silence is the only honest output, and it must not
    // depend on which of two redundant checks happens to notice.
    writeFileSync(join(repo, '.keel', 'keel.mjs'), readFileSync(ENGINE, 'utf8'));
    const result = spawnSync('node', [join(repo, '.keel', 'keel.mjs'), 'doctor'], { cwd: repo, encoding: 'utf8' });
    const out = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0);
    assert.doesNotMatch(out, /vendored \.keel/);
  });

  test('doctor says nothing about a repo that vendors nothing', () => {
    unvendor();
    const { status, out } = run('doctor');
    assert.doesNotMatch(out, /vendored/i);
    assert.equal(status, 0);
  });
});
