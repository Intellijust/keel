import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kindOf, INERT, classifyChange } from './keel.mjs';

const ENGINE = join(dirname(fileURLToPath(import.meta.url)), 'keel.mjs');

let repo;

function write(path, text = 'export const a = 1;\n') {
  mkdirSync(join(repo, dirname(path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function run(...args) {
  const result = spawnSync('node', [ENGINE, 'untested', ...args], { cwd: repo, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

function json(...args) {
  return JSON.parse(run('--json', ...args).out);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'keel-untested-'));
  mkdirSync(join(repo, '.keel'), { recursive: true });
  writeFileSync(
    join(repo, '.keel', 'config.json'),
    JSON.stringify({ contracts: 'contracts', surfaces: [{ name: 'app', root: 'src' }] }),
  );
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('kindOf — what a file is', () => {
  test('a filename suffix decides the kind, matched on the basename not the path', () => {
    assert.equal(kindOf('src/auth/jwt.guard.ts'), 'guard');
    assert.equal(kindOf('src/users/users.service.ts'), 'service');
    assert.equal(kindOf('src/users/users.controller.ts'), 'controller');
    // A directory called `dto` must not make its contents dtos.
    assert.equal(kindOf('src/dto/user.ts'), 'module');
    assert.equal(kindOf('src/types/thing.ts'), 'module');
  });

  test('the first matching suffix wins', () => {
    // `.service.` is ranked above `.dto.`, so this is a service, not a dto.
    assert.equal(kindOf('src/users/user.service.dto.ts'), 'service');
    assert.equal(kindOf('src/users/user.dto.service.ts'), 'service');
  });

  test('a name beginning use and a capital is a hook, with or without a suffix', () => {
    assert.equal(kindOf('src/useSession.ts'), 'hook');
    assert.equal(kindOf('src/useSession.tsx'), 'hook');
    assert.equal(kindOf('src/session.hook.ts'), 'hook');
    // Not a hook: no capital after `use`.
    assert.equal(kindOf('src/users.ts'), 'module');
  });

  test('a tsx or jsx file carrying no other signal is a component', () => {
    assert.equal(kindOf('src/Button.tsx'), 'component');
    assert.equal(kindOf('src/Button.jsx'), 'component');
    // A signal beats the extension.
    assert.equal(kindOf('src/user.dto.tsx'), 'dto');
  });

  test('a file named index.* is a barrel', () => {
    assert.equal(kindOf('src/users/index.ts'), 'barrel');
    assert.equal(kindOf('src/users/index.tsx'), 'component', 'the extension signal is read first');
    assert.equal(kindOf('src/users/indexer.ts'), 'module', 'index is a prefix, not a substring');
  });

  test('an unrecognised name is a module, which is a gated kind and never inert', () => {
    assert.equal(kindOf('cmd/server/main.go'), 'module');
    assert.equal(kindOf('app/models/user.rb'), 'module');
    assert.equal(kindOf('src/anything_at_all.ts'), 'module');
    assert.equal(INERT.has('module'), false, 'an unfamiliar stack must fail closed, not silent');
  });

  test('dto, types, constants, barrel, wiring and schema are the inert kinds', () => {
    assert.deepEqual([...INERT].sort(), ['barrel', 'constants', 'dto', 'schema', 'types', 'wiring'].sort());
    for (const path of ['a.dto.ts', 'a.types.ts', 'a.constants.ts', 'index.ts', 'a.module.ts', 'a.schema.ts']) {
      assert.equal(INERT.has(kindOf(path)), true, path);
    }
    for (const path of ['a.service.ts', 'a.controller.ts', 'a.guard.ts', 'Button.tsx', 'useThing.ts', 'main.go']) {
      assert.equal(INERT.has(kindOf(path)), false, path);
    }
  });

  test('undeclared and untested read inertness from the same set', () => {
    // One set, one function: the gate and the backlog cannot drift apart.
    for (const path of ['src/a.dto.ts', 'src/index.ts', 'src/a.module.ts']) {
      assert.equal(INERT.has(kindOf(path)), true);
      assert.equal(classifyChange(path, { contractsDir: 'contracts' }), 'inert');
    }
    for (const path of ['src/a.service.ts', 'src/Button.tsx']) {
      assert.equal(INERT.has(kindOf(path)), false);
      assert.equal(classifyChange(path, { contractsDir: 'contracts' }), 'source');
    }
  });
});

describe('pairing a source file with its test', () => {
  test('a test anywhere in the repo pairs by basename alone', () => {
    write('src/users.service.ts');
    write('elsewhere/far/away/users.service.spec.ts', 'test("x", () => {});\n');

    assert.deepEqual(json().surfaces[0].untested, []);
  });

  test('two source files sharing a basename both read as tested when either has a test', () => {
    write('src/admin/list.ts');
    write('src/public/list.ts');
    write('src/admin/list.spec.ts', 'test("x", () => {});\n');

    const report = json();
    assert.deepEqual(report.surfaces[0].untested, [], 'the known limitation: pairing is by name, not by path');
  });

  test('untested states the collision, so the limitation reaches whoever reads the backlog', () => {
    write('src/admin/list.ts');
    write('src/public/list.ts');
    write('src/admin/list.spec.ts', 'test("x", () => {});\n');

    const { out } = run();

    assert.match(out, /share a basename/i);
  });

  test('no shared basenames means no caveat printed', () => {
    write('src/one.service.ts');
    write('src/two.service.ts');

    assert.doesNotMatch(run().out, /share a basename/i);
  });

  test('a .d.ts file is never source', () => {
    write('src/globals.d.ts', 'declare const x: number;\n');
    assert.deepEqual(json().surfaces[0].untested, []);
  });

  test('a name carrying .gen. or .generated. is never source', () => {
    write('src/client.gen.ts');
    write('src/schema.generated.tsx');
    assert.deepEqual(json().surfaces[0].untested, []);
  });

  test('a dist, migrations, test, tests, __tests__, __mocks__, e2e or fixtures segment puts a file outside source', () => {
    for (const segment of ['dist', 'migrations', 'test', 'tests', '__tests__', '__mocks__', 'e2e', 'fixtures']) {
      write(`src/${segment}/thing.service.ts`);
    }
    assert.deepEqual(json().surfaces[0].untested, []);
  });

  test('only the js/ts family is scanned, so another language reports nothing rather than guessing', () => {
    write('src/server.go', 'package main\n');
    write('src/app.rb', 'class App; end\n');
    write('src/main.py', 'x = 1\n');

    assert.deepEqual(json().surfaces[0].untested, []);
  });
});

describe('the untested report', () => {
  test('loc counts lines that are neither blank nor a // comment', () => {
    write('src/thing.service.ts', [
      '// a comment',
      '',
      'export const a = 1;',
      '   ',
      '  // an indented comment',
      'export const b = 2;',
    ].join('\n'));

    assert.equal(json().surfaces[0].untested[0].loc, 2);
  });

  test('files list longest first', () => {
    write('src/small.service.ts', 'export const a = 1;\n');
    write('src/big.service.ts', Array.from({ length: 10 }, (_, i) => `export const a${i} = ${i};`).join('\n'));

    assert.deepEqual(json().surfaces[0].untested.map((f) => f.file), ['src/big.service.ts', 'src/small.service.ts']);
  });

  test('the text report caps at 40 per surface while --json carries all of them', () => {
    for (let i = 0; i < 45; i += 1) write(`src/thing${i}.service.ts`);

    assert.equal(json().surfaces[0].untested.length, 45);
    const { out } = run();
    assert.match(out, /and 5 more/);
    assert.equal((out.match(/\.service\.ts/g) ?? []).length, 40);
  });

  test('inert files are counted per surface rather than listed', () => {
    write('src/a.dto.ts');
    write('src/b.types.ts');
    write('src/c.service.ts');

    const surface = json().surfaces[0];
    assert.equal(surface.inertSkipped, 2);
    assert.deepEqual(surface.untested.map((f) => f.file), ['src/c.service.ts']);
    assert.match(run().out, /2 inert skipped/);
  });
});
