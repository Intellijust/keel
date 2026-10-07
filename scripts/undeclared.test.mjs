import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  movedNodes,
  attributeToSurface,
  contractCoversSurface,
  classifyChange,
  matchesGlob,
  exemptionFrom,
  undeclaredVerdict,
} from './keel.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), 'keel.mjs');

/**
 * A throwaway git repo. Every node here is about a *diff*, so a real repo with real
 * commits is the only honest fixture — a fake would be testing the fake.
 */
let repo;

function git(...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(path, text) {
  mkdirSync(join(repo, dirname(path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function read(path) {
  return readFileSync(join(repo, path), 'utf8');
}

function commit(message = 'change') {
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--no-gpg-sign', '-m', message);
}

/** Runs the real CLI in the throwaway repo. */
function run(...args) {
  const result = spawnSync('node', [ENGINE, 'undeclared', ...args], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

const CONTRACT = [
  '---',
  'domain: web',
  'surface: apps/web',
  'tests: apps/web/**/*.spec.tsx',
  '---',
  '',
  '# Web',
  '',
  '## The classes page',
  '',
  'Prose the parser ignores.',
  '',
  '- [x] a basket of one reads "1 item"',
  '',
].join('\n');

const FIXED = 'export const label = (n) => (n === 1 ? "1 item" : `${n} items`);\n';

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'keel-undeclared-'));
  mkdirSync(join(repo, '.keel'), { recursive: true });
  writeFileSync(
    join(repo, '.keel', 'config.json'),
    JSON.stringify({
      contracts: 'contracts',
      surfaces: [{ name: 'web', root: 'apps/web' }, { name: 'api', root: 'apps/api' }],
    }),
  );
  git('init', '-q', '-b', 'main');
  write('contracts/web.md', CONTRACT);
  write('apps/web/src/basket-page.tsx', 'export const label = (n) => `${n} items`;\n');
  write('apps/api/src/orders.service.ts', 'export const list = () => [];\n');
  commit('base');
  git('branch', 'base');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('undeclared — behaviour source that changed while no node did', () => {
  test('source changed and no node moved is a non-zero exit naming the surface and the file', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('fix pluralisation');

    const { status, out } = run('--base', 'base');

    assert.notEqual(status, 0);
    assert.match(out, /web/);
    assert.match(out, /apps\/web\/src\/basket-page\.tsx/);
    assert.match(out, /no contract node moved/i);
  });

  test('a contract edit that moves no node satisfies nothing', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    write('contracts/web.md', CONTRACT.replace('Prose the parser ignores.', 'Prose, reworded entirely.'));
    commit('fix, and touch the contract');

    const { status, out } = run('--base', 'base');

    assert.notEqual(status, 0, 'editing prose in a contract file must not answer for a behaviour change');
    assert.match(out, /0 added, 0 removed, 0 status-changed/);
  });

  test('adding a node answers for the change', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    write('contracts/web.md', `${CONTRACT}- [x] a basket of none reads "no items"\n`);
    commit('fix, with the node');

    const { status, out } = run('--base', 'base');

    assert.equal(status, 0);
    assert.match(out, /1 added/);
  });

  test('a node flipped from broken to held answers for the change — the bug-fix shape', () => {
    write('contracts/web.md', CONTRACT.replace('- [x] a basket of one', '- [!] a basket of one (broken: AUTH-12)'));
    commit('QA filed it; mark the node broken');
    git('branch', '-f', 'base');

    write('apps/web/src/basket-page.tsx', FIXED);
    write('contracts/web.md', CONTRACT);
    commit('fix it, and mark the node held');

    const { status, out } = run('--base', 'base');

    assert.equal(status, 0);
    assert.match(out, /1 added|1 removed|status-changed/);
  });

  test('marking a node broken and fixing it in one branch is movement, not a net zero', () => {
    write('contracts/web.md', CONTRACT.replace('- [x] a basket of one', '- [!] a basket of one (broken: AUTH-12)'));
    commit('mark it broken');
    write('apps/web/src/basket-page.tsx', FIXED);
    write('contracts/web.md', CONTRACT);
    commit('fix it, and mark it held again');

    const { status, out } = run('--base', 'base');

    assert.equal(status, 0, 'the file is identical at both ends, but the node moved twice in between');
    assert.match(out, /within the range/);
  });

  test('a test file alone is never changed source', () => {
    write('apps/web/src/basket-page.spec.tsx', 'test("x", () => {});\n');
    commit('a test, and nothing else');

    const { status, out } = run('--base', 'base');

    assert.equal(status, 0, 'a diff of tests only describes no new behaviour on its own');
    assert.match(out, /no behaviour source changed/);
  });

  test('an inert file is skipped, and named so the skip is never silent', () => {
    write('apps/web/src/user.dto.ts', 'export type User = { id: string };\n');
    commit('a dto');

    const { status, out } = run('--base', 'base');

    assert.equal(status, 0);
    assert.match(out, /skipped as inert \(dto\): apps\/web\/src\/user\.dto\.ts/);
  });

  test('a file under no surface root is not behaviour source, and is reported as ungated', () => {
    write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
    write('README.md', '# changed\n');
    commit('bump a lockfile');

    const { status, out } = run('--base', 'base');

    assert.equal(status, 0, 'a lockfile bump is not a behaviour change');
    assert.match(out, /ungated — under no surface root: pnpm-lock\.yaml/);
  });

  test('an excluded path is skipped, and named the same way', () => {
    writeFileSync(
      join(repo, '.keel', 'config.json'),
      JSON.stringify({
        contracts: 'contracts',
        surfaces: [{ name: 'web', root: 'apps/web' }],
        undeclared: { exclude: ['apps/web/src/generated/**'] },
      }),
    );
    write('apps/web/src/generated/client.ts', 'export const v = 2;\n');
    commit('regenerate');

    const { status, out } = run('--base', 'base');

    assert.equal(status, 0);
    assert.match(out, /skipped by undeclared\.exclude: apps\/web\/src\/generated\/client\.ts/);
  });

  test('a node moving in another surface’s contract does not answer for this one', () => {
    write('contracts/api.md', '---\ndomain: api\nsurface: apps/api\n---\n\n# Api\n\n## Lists\n\n- [x] lists are empty by default\n');
    commit('an api contract');
    write('apps/web/src/basket-page.tsx', FIXED);
    write('contracts/api.md', '---\ndomain: api\nsurface: apps/api\n---\n\n# Api\n\n## Lists\n\n- [x] lists are empty by default\n- [x] lists page at 50\n');
    commit('fix web, declare api');

    const { status } = run('--base', 'base');

    assert.notEqual(status, 0, 'an api node cannot answer for a change under apps/web');
  });

  test('the report says when tests changed alongside — the measured failure shape', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    write('apps/web/src/basket-page.spec.tsx', 'test("x", () => {});\n');
    commit('fix, pinned by a test, declared nowhere');

    const { out } = run('--base', 'base');

    assert.match(out, /1 test file\(s\) changed in the same diff — behaviour pinned by a test no node describes/);
  });

  test('--exempt passes, and prints the reason in full', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('rename only');

    const { status, out } = run('--base', 'base', '--exempt', 'pure rename, no behaviour');

    assert.equal(status, 0);
    assert.match(out, /EXEMPT via --exempt: pure rename, no behaviour/);
  });

  test('a Keel-Exempt trailer on a commit in the range does the same', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('Extract a helper\n\nKeel-Exempt: pure refactor, no behaviour change');

    const { status, out } = run('--base', 'base');

    assert.equal(status, 0);
    assert.match(out, /EXEMPT via Keel-Exempt trailer: pure refactor, no behaviour change/);
  });

  test('an exemption with no reason is refused', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('fix');

    const { status, out } = run('--base', 'base', '--exempt', '   ');

    assert.notEqual(status, 0);
    assert.match(out, /needs a reason/);
  });

  test('a base ref git cannot resolve fails with advice, never a green', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('fix');

    const { status, out } = run('--base', 'origin/nope');

    assert.notEqual(status, 0);
    assert.match(out, /cannot resolve base ref 'origin\/nope'/);
    assert.doesNotMatch(out, /no behaviour source changed/);
  });

  test('git being unavailable fails rather than exiting zero', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('fix');

    // A PATH holding node and nothing else: git is gone, the engine still runs.
    const bin = join(repo, 'bin');
    mkdirSync(bin, { recursive: true });
    symlinkSync(process.execPath, join(bin, 'node'));
    const result = spawnSync(process.execPath, [ENGINE, 'undeclared', '--base', 'base'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: bin },
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /git is not available/);
  });

  test('with no --base it reads undeclared.base from config', () => {
    writeFileSync(
      join(repo, '.keel', 'config.json'),
      JSON.stringify({
        contracts: 'contracts',
        surfaces: [{ name: 'web', root: 'apps/web' }],
        undeclared: { base: 'base' },
      }),
    );
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('fix');

    const { status, out } = run();

    assert.notEqual(status, 0);
    assert.match(out, /\(against base\)/);
  });

  test('with neither flag nor config it falls back to origin/main, and says so when that is unresolvable', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('fix');

    const { status, out } = run();

    assert.notEqual(status, 0);
    assert.match(out, /cannot resolve base ref 'origin\/main'/);
  });

  test('--staged reads the index, so a pre-commit hook can run before the commit exists', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    git('add', '-A');

    const { status, out } = run('--staged');

    assert.notEqual(status, 0);
    assert.match(out, /against the index/);
    assert.match(out, /apps\/web\/src\/basket-page\.tsx/);
  });

  test('--staged judges the staged contract, not the unstaged edit sitting beside it', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    git('add', '-A');
    // Staged: no node. On disk: a node. The index is what is about to be committed.
    write('contracts/web.md', `${CONTRACT}- [x] a basket of none reads "no items"\n`);

    const { status } = run('--staged');

    assert.notEqual(status, 0, 'an unstaged node must not answer for a staged behaviour change');
  });

  test('--json carries the surfaces, the moved counts, and the verdict', () => {
    write('apps/web/src/basket-page.tsx', FIXED);
    commit('fix');

    const { status, out } = run('--base', 'base', '--json');
    const report = JSON.parse(out);

    assert.notEqual(status, 0);
    assert.equal(report.verdict, 'fail');
    assert.equal(report.base, 'base');
    assert.deepEqual(report.surfaces.find((s) => s.name === 'web').source, ['apps/web/src/basket-page.tsx']);
    assert.equal(report.exemption, null);
  });

  test('the working tree counts, not only what is committed', () => {
    write('apps/web/src/basket-page.tsx', FIXED);

    const { status } = run('--base', 'base');

    assert.notEqual(status, 0, 'an uncommitted behaviour change is still a behaviour change');
    assert.equal(read('apps/web/src/basket-page.tsx'), FIXED, 'the command must not touch the tree');
  });
});

describe('the pure parts', () => {
  const nodes = (...triples) => triples.map(([file, text, status]) => ({ file, text, status }));

  test('movedNodes sees additions, removals, re-wordings and status changes', () => {
    const before = nodes(['c.md', 'a', 'held'], ['c.md', 'b', 'open']);

    assert.equal(movedNodes(before, before).added.length, 0);
    assert.equal(movedNodes(before, before).removed.length, 0);
    assert.equal(movedNodes(before, before).changed.length, 0);

    assert.equal(movedNodes(before, nodes(['c.md', 'a', 'held'], ['c.md', 'b', 'open'], ['c.md', 'c', 'open'])).added.length, 1);
    assert.equal(movedNodes(before, nodes(['c.md', 'a', 'held'])).removed.length, 1);
    assert.equal(movedNodes(before, nodes(['c.md', 'a', 'broken'], ['c.md', 'b', 'open'])).changed.length, 1);

    // A re-wording is a removal and an addition, never a silent edit.
    const reworded = movedNodes(before, nodes(['c.md', 'a but better', 'held'], ['c.md', 'b', 'open']));
    assert.equal(reworded.added.length, 1);
    assert.equal(reworded.removed.length, 1);
  });

  test('the same text in two contract files is two different nodes', () => {
    const before = nodes(['web.md', 'a', 'held']);
    const after = nodes(['web.md', 'a', 'held'], ['api.md', 'a', 'held']);
    assert.equal(movedNodes(before, after).added.length, 1);
  });

  test('attributeToSurface takes the longest matching root', () => {
    const surfaces = [{ name: 'apps', root: 'apps' }, { name: 'web', root: 'apps/web' }];
    assert.equal(attributeToSurface('apps/web/src/x.tsx', surfaces), 'web');
    assert.equal(attributeToSurface('apps/other/src/x.ts', surfaces), 'apps');
    assert.equal(attributeToSurface('packages/shared/x.ts', surfaces), null);
    assert.equal(attributeToSurface('apps/webbing/x.ts', surfaces), 'apps', 'a prefix is not a directory');
  });

  test('a contract naming neither surface nor tests answers for every surface', () => {
    const web = { name: 'web', root: 'apps/web' };
    assert.equal(contractCoversSurface({}, web), true);
    assert.equal(contractCoversSurface({ surface: 'apps/web' }, web), true);
    assert.equal(contractCoversSurface({ tests: 'apps/web/**/*.spec.tsx' }, web), true);
    assert.equal(contractCoversSurface({ surface: 'apps/api' }, web), false);
  });

  test('classifyChange separates contract, test, excluded, inert and source', () => {
    const opts = { contractsDir: 'contracts', exclude: ['**/*.css'] };
    assert.equal(classifyChange('contracts/web.md', opts), 'contract');
    assert.equal(classifyChange('apps/web/src/a.spec.tsx', opts), 'test');
    assert.equal(classifyChange('apps/web/src/a.css', opts), 'excluded');
    assert.equal(classifyChange('apps/web/src/a.dto.ts', opts), 'inert');
    assert.equal(classifyChange('apps/web/src/a.tsx', opts), 'source');
    // Language-agnostic: no extension whitelist, so a Go or Python repo is gated too.
    assert.equal(classifyChange('cmd/server/main.go', opts), 'source');
  });

  test('matchesGlob handles a segment star and a crossing double star', () => {
    assert.equal(matchesGlob('apps/web/src/a.css', '**/*.css'), true);
    assert.equal(matchesGlob('a.css', '**/*.css'), true);
    assert.equal(matchesGlob('apps/web/gen/x.ts', 'apps/web/gen/**'), true);
    assert.equal(matchesGlob('apps/web/src/x.ts', 'apps/web/gen/**'), false);
    assert.equal(matchesGlob('apps/web/a/b.ts', 'apps/web/*.ts'), false);
  });

  test('an exemption is a reason or it is nothing', () => {
    assert.equal(exemptionFrom({}), null);
    assert.equal(exemptionFrom({ flag: 'a reason' }).reason, 'a reason');
    assert.equal(exemptionFrom({ messages: ['x\n\nKeel-Exempt: moved a file'] }).reason, 'moved a file');
    assert.equal(exemptionFrom({ messages: ['x\n\nkeel-exempt: lowercase counts'] }).reason, 'lowercase counts');
    assert.throws(() => exemptionFrom({ flag: '  ' }), /needs a reason/);
    assert.throws(() => exemptionFrom({ messages: ['x\n\nKeel-Exempt:   '] }), /needs a reason/);
  });

  test('the verdict is non-zero exactly when source changed and nothing moved', () => {
    assert.equal(undeclaredVerdict([{ source: [], moved: 0 }]), 0);
    assert.equal(undeclaredVerdict([{ source: ['a.ts'], moved: 1 }]), 0);
    assert.equal(undeclaredVerdict([{ source: ['a.ts'], moved: 0 }]), 1);
    assert.equal(undeclaredVerdict([{ source: ['a.ts'], moved: 2 }, { source: ['b.ts'], moved: 0 }]), 1);
  });
});
