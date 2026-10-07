import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintNode, scriptsNamedIn, untestedTooling } from './keel.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), 'keel.mjs');

const node = (text) => ({ text, file: 'contracts/x.md', line: 1 });

describe('lintNode — nodes that no single test could prove', () => {
  test('a node naming three or more identifiers is flagged as a list of functions', () => {
    const problems = lintNode(
      node('invitations: `createInvitation`, `resendInvitation`, `deleteInvitation` and their scope checks'),
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0], /3 code spans/);
  });

  test('a node quoting markers or annotations is not flagged — those describe one behaviour', () => {
    // The false positive the first draft of this heuristic produced: markers and
    // parenthesised annotations are not function names.
    assert.deepEqual(
      lintNode(node('a `- [x]` line is held, `- [ ]` open, `[~]` deferred, `[!]` broken')),
      [],
    );
    assert.deepEqual(
      lintNode(node('a `(deferred: reason)` or `(defer: reason)` annotation is captured')),
      [],
    );
  });

  test('a node over the word limit is flagged as prose rather than behaviour', () => {
    const problems = lintNode(node(Array.from({ length: 41 }, (_, i) => `word${i}`).join(' ')));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /41 words/);
  });

  test('the limits are configurable, so a project can set its own grain', () => {
    assert.equal(lintNode(node('one two three'), { maxWords: 2 }).length, 1);
    assert.equal(lintNode(node('`a` and `b`'), { maxCodeSpans: 2 }).length, 1);
  });

  test('a well-formed node yields nothing', () => {
    assert.deepEqual(
      lintNode(node('rejects an expired refresh token with 401 and no session cookie')),
      [],
    );
  });

  test('a node can be flagged for both reasons at once', () => {
    const long = `${Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ')} \`aa\` \`bb\` \`cc\``;
    assert.equal(lintNode(node(long)).length, 2);
  });
});

describe('scriptsNamedIn — which in-repo scripts a command runs', () => {
  test('finds the script a node command runs', () => {
    assert.deepEqual(scriptsNamedIn('node scripts/mutation-gate.mjs --base main'), [
      'scripts/mutation-gate.mjs',
    ]);
  });

  test('a command naming no script yields none, rather than guessing a filename', () => {
    assert.deepEqual(scriptsNamedIn('pnpm --filter @org/api exec jest --runInBand'), []);
    assert.deepEqual(scriptsNamedIn('nx affected -t test --base=origin/main'), []);
  });

  test('a flag that happens to end in .js is not mistaken for a script', () => {
    // `--inspect-brk.js` matches the path shape; without the leading-dash filter
    // doctor would report a nonexistent script from a real command line.
    assert.deepEqual(scriptsNamedIn('node --inspect-brk.js foo'), []);
  });

  test('several scripts in one command are all found', () => {
    assert.deepEqual(scriptsNamedIn('node a/one.mjs && node b/two.js'), ['a/one.mjs', 'b/two.js']);
  });
});

describe('untestedTooling — invariant 5, made mechanical', () => {
  const exists = () => true;

  test('a gate script nothing tests is reported with the command that runs it', () => {
    const found = untestedTooling(
      { mutation: 'node scripts/gate.mjs' },
      { exists, isTested: () => false },
    );
    assert.deepEqual(found, [{ command: 'mutation', script: 'scripts/gate.mjs' }]);
  });

  test('a gate script that is tested is not reported', () => {
    assert.deepEqual(
      untestedTooling({ mutation: 'node scripts/gate.mjs' }, { exists, isTested: () => true }),
      [],
    );
  });

  test('a script named but absent from the repo is not reported — it is not ours to test', () => {
    assert.deepEqual(
      untestedTooling(
        { test: 'node ../elsewhere/tool.mjs' },
        { exists: () => false, isTested: () => false },
      ),
      [],
    );
  });

  test('no commands at all is not an error', () => {
    assert.deepEqual(untestedTooling(undefined, { exists, isTested: () => false }), []);
  });
});

describe('doctor — a gate installed and never run', () => {
  let repo;

  function setup({ wiring = null, vendored = null } = {}) {
    repo = mkdtempSync(join(tmpdir(), 'keel-gatewire-'));
    mkdirSync(join(repo, '.keel'), { recursive: true });
    mkdirSync(join(repo, 'contracts'), { recursive: true });
    writeFileSync(join(repo, 'contracts', 'a.md'), '# A\n\n## G\n\n- [x] a thing holds\n');
    writeFileSync(join(repo, '.keel', 'config.json'), JSON.stringify({
      contracts: 'contracts',
      commands: { lint: 'true', test: 'true' },
      review: { model: 'fable' },
    }));
    writeFileSync(join(repo, 'MENTAL_MODEL.md'), [
      '# M', '## 1. What this system is for', 'x', '## 2. Vocabulary', 'x',
      '## 3. Invariants', 'x', '## 4. The shape', 'x', '## 5. Decisions', 'x',
      '## 6. Sharp edges', 'x', '## 7. What this system deliberately does not do', 'x',
    ].join('\n'));
    writeFileSync(join(repo, 'CLAUDE.md'), '@MENTAL_MODEL.md\n');
    if (wiring) {
      mkdirSync(join(repo, dirname(wiring.path)), { recursive: true });
      writeFileSync(join(repo, wiring.path), wiring.text);
    }
    if (vendored !== null) writeFileSync(join(repo, '.keel', 'keel.mjs'), vendored);
    return repo;
  }

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  function doctor() {
    const result = spawnSync('node', [ENGINE, 'doctor'], { cwd: repo, encoding: 'utf8' });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  test('nothing invoking undeclared is reported, and the report names where it looked', () => {
    setup();
    const { out } = doctor();
    assert.match(out, /warn\s+nothing invokes `undeclared`/);
    assert.match(out, /\.github\/workflows/);
  });

  test('it is a warning, never a FAIL', () => {
    setup();
    const { status, out } = doctor();
    assert.equal(status, 0, "doctor's exit code is an API — an unwired gate is debt, not a broken install");
    assert.doesNotMatch(out, /FAIL\s+nothing invokes/);
  });

  test('a CI step invoking the gate silences it', () => {
    setup({ wiring: { path: '.github/workflows/pr.yml', text: 'run: node .keel/keel.mjs undeclared --base origin/main\n' } });
    assert.doesNotMatch(doctor().out, /nothing invokes `undeclared`/);
  });

  test('a pre-commit hook invoking the gate silences it', () => {
    setup({ wiring: { path: '.husky/pre-commit', text: 'node .keel/keel.mjs undeclared --staged\n' } });
    assert.doesNotMatch(doctor().out, /nothing invokes `undeclared`/);
  });

  test('a vendored engine predating the gate is not nagged for failing to run it', () => {
    setup({ vendored: "export const KEEL_VERSION = '0.3.0';\n" });
    assert.doesNotMatch(doctor().out, /nothing invokes `undeclared`/);
  });

  test('a vendored engine new enough to carry the gate is nagged', () => {
    setup({ vendored: "export const KEEL_VERSION = '0.4.0';\n" });
    assert.match(doctor().out, /nothing invokes `undeclared`/);
  });
});
