import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planMutation, verdictFor } from './keel.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), 'keel.mjs');

/**
 * A throwaway repo with a `.keel/config.json` (so the engine roots there rather
 * than walking up into Keel's own checkout) and one source file to mutate.
 */
let repo;
const SOURCE = 'src/thing.js';
const ORIGINAL = 'export function pick(a, b) {\n  return a > b ? a : b;\n}\n';

before(() => {
  repo = mkdtempSync(join(tmpdir(), 'keel-mutate-repo-'));
  mkdirSync(join(repo, '.keel'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, '.keel', 'config.json'), '{"contracts":"contracts"}');
});
after(() => rmSync(repo, { recursive: true, force: true }));

function writeSource(text = ORIGINAL) {
  writeFileSync(join(repo, SOURCE), text);
}
function readSource() {
  return readFileSync(join(repo, SOURCE), 'utf8');
}

/** Runs the real CLI in the throwaway repo. */
function run(args) {
  const result = spawnSync('node', [ENGINE, 'mutate', ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** A command that passes, and one that fails — standing in for a test suite. */
const PASSES = ['--', 'node', '-e', 'process.exit(0)'];
const FAILS = ['--', 'node', '-e', 'process.exit(1)'];

describe('planMutation — refusing before anything is written', () => {
  test('a find string occurring exactly once produces the mutated text', () => {
    const plan = planMutation({ text: 'a b c', find: 'b', replace: 'B' });
    assert.equal(plan.ok, true);
    assert.equal(plan.count, 1);
    assert.equal(plan.mutated, 'a B c');
  });

  test('a find string occurring more than once is refused, and says how many', () => {
    const plan = planMutation({ text: 'a b b c', find: 'b', replace: 'B' });
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'ambiguous');
    assert.equal(plan.count, 2);
  });

  test('a find string that does not occur is refused', () => {
    const plan = planMutation({ text: 'a b c', find: 'zzz', replace: 'B' });
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'not-found');
  });

  test('an empty find string is refused rather than matching everywhere', () => {
    assert.equal(planMutation({ text: 'a b c', find: '', replace: 'x' }).ok, false);
  });

  test('replacing with nothing is a legitimate mutation — deleting a line is how a guard is broken', () => {
    const plan = planMutation({ text: 'if (x) return;\nrest', find: 'if (x) return;\n', replace: '' });
    assert.equal(plan.ok, true);
    assert.equal(plan.mutated, 'rest');
  });
});

describe('verdictFor — a failing command is the good outcome', () => {
  test('a command that failed means the mutant was killed, and the run exits zero', () => {
    assert.deepEqual(verdictFor(1), { killed: true, label: 'killed', exitCode: 0 });
  });

  test('a command that passed means the mutant survived, and the run exits non-zero', () => {
    assert.deepEqual(verdictFor(0), { killed: false, label: 'survived', exitCode: 1 });
  });
});

describe('the mutate command, end to end', () => {
  test('applies the mutation, runs the command against it, and restores the file byte-for-byte', () => {
    writeSource();
    const { status, out } = run([SOURCE, '--find', 'a > b', '--replace', 'a < b', ...FAILS]);

    assert.equal(readSource(), ORIGINAL, 'file must be back to its original bytes');
    assert.match(out, /MUTANT KILLED/);
    assert.equal(status, 0, 'a killed mutant exits zero');
  });

  test('reports SURVIVED, and still restores, when the command passes against the mutation', () => {
    writeSource();
    const { status, out } = run([SOURCE, '--find', 'a > b', '--replace', 'a < b', ...PASSES]);

    assert.equal(readSource(), ORIGINAL);
    assert.match(out, /MUTANT SURVIVED/);
    assert.notEqual(status, 0, 'a surviving mutant must not exit zero');
  });

  test('restores the file when the command crashes rather than exiting cleanly', () => {
    writeSource();
    run([SOURCE, '--find', 'a > b', '--replace', 'a < b', '--', 'node', '-e', 'throw new Error("boom")']);

    assert.equal(readSource(), ORIGINAL);
  });

  test('an ambiguous find string writes nothing at all', () => {
    // `return` appears once, but `a` appears many times: the mutation is not
    // uniquely determined, so the file must be untouched.
    writeSource();
    const { status, out } = run([SOURCE, '--find', 'a', '--replace', 'z', ...FAILS]);

    assert.equal(readSource(), ORIGINAL);
    assert.match(out, /occurs \d+ times/);
    assert.match(out, /Nothing was written/);
    assert.notEqual(status, 0);
  });

  test('a find string that does not occur writes nothing at all', () => {
    writeSource();
    const { status, out } = run([SOURCE, '--find', 'not-in-the-file', '--replace', 'x', ...FAILS]);

    assert.equal(readSource(), ORIGINAL);
    assert.match(out, /does not occur/);
    assert.notEqual(status, 0);
  });

  test('uncommitted edits in the mutated file survive — the failure `git checkout <file>` caused', () => {
    // The file is deliberately NOT what git has: this is the case that lost work
    // twice on 2026-08-26.
    const edited = `${ORIGINAL}// an uncommitted edit worth keeping\n`;
    writeSource(edited);

    run([SOURCE, '--find', 'a > b', '--replace', 'a < b', ...FAILS]);

    assert.equal(readSource(), edited, 'the working-tree version must come back, not HEAD');
  });

  test('a missing file fails before anything is touched', () => {
    const { status, out } = run(['src/nope.js', '--find', 'a', '--replace', 'b', ...FAILS]);
    assert.match(out, /no such file/);
    assert.notEqual(status, 0);
  });

  test('a mutation with no command to run is refused', () => {
    writeSource();
    const { status, out } = run([SOURCE, '--find', 'a > b', '--replace', 'a < b']);

    assert.equal(readSource(), ORIGINAL);
    assert.match(out, /needs a command/);
    assert.notEqual(status, 0);
  });

  test('the verdict is printed in words, so a passing command is never mistaken for a passing gate', () => {
    writeSource();
    const { out } = run([SOURCE, '--find', 'a > b', '--replace', 'a < b', ...PASSES]);
    assert.match(out, /Nothing pins this behaviour/);
  });
});
