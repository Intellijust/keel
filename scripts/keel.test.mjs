import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseContract } from './keel.mjs';

/** parseContract reads from disk, so each case writes a real temp file. */
function parsed(markdown) {
  const dir = mkdtempSync(join(tmpdir(), 'keel-test-'));
  const file = join(dir, 'domain.md');
  writeFileSync(file, markdown);
  try {
    return parseContract(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('parsing a contract file — the format is whatever this accepts', () => {
  test('each marker maps to its status, under - and * bullets alike', () => {
    const { nodes } = parsed(
      [
        '## G',
        '- [x] held thing',
        '- [ ] open thing',
        '* [~] deferred thing (deferred: waiting on AUTH-1)',
        '* [!] broken thing (broken: returns 500)',
      ].join('\n'),
    );

    assert.deepEqual(
      nodes.map((n) => n.status),
      ['held', 'open', 'deferred', 'broken'],
    );
  });

  test('a bracket carrying any other character is not a node, not a guessed status', () => {
    const { nodes } = parsed('## G\n- [?] mystery\n- [X] uppercase\n- [x] real');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].text, 'real');
  });

  test('a node belongs to the nearest ##-or-deeper heading; the # title is never a group', () => {
    const { nodes } = parsed(
      ['# Title', '- [ ] before any section', '## Auth', '- [ ] in auth', '### Tokens', '- [ ] in tokens'].join('\n'),
    );

    assert.deepEqual(
      nodes.map((n) => n.group),
      [null, 'Auth', 'Tokens'],
    );
  });

  test('two-space indentation nests, and a tab counts as two spaces', () => {
    const { nodes } = parsed('## G\n- [ ] parent\n  - [ ] child\n\t- [ ] tab child');
    assert.deepEqual(
      nodes.map((n) => n.depth),
      [0, 1, 1],
    );
  });

  test('deferred and broken reasons are captured, case-insensitively, under both spellings', () => {
    const { nodes } = parsed(
      [
        '## G',
        '- [~] a (deferred: needs the integration tier)',
        '- [~] b (Defer: shorthand)',
        '- [!] c (broken: 500s)',
        '- [!] d (regression: since AUTH-9)',
      ].join('\n'),
    );

    assert.deepEqual(
      nodes.map((n) => n.reason),
      ['needs the integration tier', 'shorthand', '500s', 'since AUTH-9'],
    );
  });

  test('a deferred node without an annotation has a null reason — the fact `contracts --open` exists to catch', () => {
    const { nodes } = parsed('## G\n- [~] silently parked');
    assert.equal(nodes[0].reason, null);
  });

  test('frontmatter between --- fences yields key/value pairs; its absence still parses', () => {
    const withFm = parsed('---\ndomain: engine\ntests: scripts/**/*.test.mjs\n---\n## G\n- [ ] a');
    assert.equal(withFm.frontmatter.domain, 'engine');
    assert.equal(withFm.frontmatter.tests, 'scripts/**/*.test.mjs');

    const without = parsed('## G\n- [ ] a');
    assert.deepEqual(without.frontmatter, {});
    assert.equal(without.nodes.length, 1);
  });

  test('line numbers are 1-based and point at the node itself, so file:line is clickable', () => {
    const { nodes } = parsed('## G\n\n- [ ] third line');
    assert.equal(nodes[0].line, 3);
  });
});
