#!/usr/bin/env node
// keel — the deterministic half of the harness.
//
// Judgment belongs to the agent. Counting, locating, and recording do not, so they
// live here where they cannot be misremembered.
//
// Commands:
//   keel probe               detect stack, package manager, and candidate commands
//   keel contracts [--open]  inventory contract nodes by status
//   keel untested [--json]   source files with no test file anywhere
//   keel undeclared          changed behaviour source that no contract node describes
//   keel model               check MENTAL_MODEL.md is present, complete, and short
//   keel unknowns            list every recorded UNKNOWN with its age
//   keel mutation            read the mutation score from Stryker's report
//   keel ledger <phase> <note...>   append a dated entry to .keel/ledger.md
//   keel version             this engine's version, and the vendored copy's
//   keel doctor              check the install is intact
//
// No dependencies. Node >= 18.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, appendFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Every command here is long enough that someone will pipe it to `head`. When they
// do, stdout closes mid-write and Node raises an unhandled EPIPE — which looks like a
// crash in the tool rather than a closed pipe.
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const ROOT = findRoot(process.cwd());
const CONFIG_PATH = join(ROOT, '.keel', 'config.json');

// Bump this and .claude-plugin/plugin.json together — doctor warns when they drift,
// because a wrong number here makes every staleness report a lie.
export const KEEL_VERSION = '0.4.0';

const ENGINE_PATH = fileURLToPath(import.meta.url);

/**
 * Two paths reaching the same file. Symlinks are the whole point: on macOS a repo
 * under /var is really /private/var, and comparing the unresolved strings made the
 * engine decide it had not been invoked as a command — exiting 0, silently, having
 * done nothing.
 */
function samePath(a, b) {
  if (!a || !b) return false;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}
const VENDORED_PATH = join(ROOT, '.keel', 'keel.mjs');

const STATUS = {
  '[x]': { key: 'held', label: 'held', blurb: 'behaviour holds, proven by a test' },
  '[ ]': { key: 'open', label: 'open', blurb: 'agreed behaviour, not yet built' },
  '[~]': { key: 'deferred', label: 'deferred', blurb: 'agreed but consciously postponed' },
  '[!]': { key: 'broken', label: 'broken', blurb: 'known not to hold' },
};

function findRoot(from) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, '.keel', 'config.json'))) return dir;
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return resolve(from);
    dir = parent;
  }
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    fail(`.keel/config.json is not valid JSON: ${error.message}`);
  }
}

function fail(message) {
  process.stderr.write(`keel: ${message}\n`);
  process.exit(1);
}

function walk(dir, hit, { skip = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nx']) } = {}) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.keel') continue;
    if (skip.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, hit, { skip });
    else hit(full);
  }
}

// ---------------------------------------------------------------- probe

function probe() {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;

  const packageManager =
    existsSync(join(ROOT, 'pnpm-lock.yaml')) ? 'pnpm'
    : existsSync(join(ROOT, 'yarn.lock')) ? 'yarn'
    : existsSync(join(ROOT, 'bun.lockb')) ? 'bun'
    : existsSync(join(ROOT, 'package-lock.json')) ? 'npm'
    : existsSync(join(ROOT, 'requirements.txt')) || existsSync(join(ROOT, 'pyproject.toml')) ? 'python'
    : existsSync(join(ROOT, 'go.mod')) ? 'go'
    : existsSync(join(ROOT, 'Cargo.toml')) ? 'cargo'
    : null;

  const signals = {
    nx: existsSync(join(ROOT, 'nx.json')),
    turbo: existsSync(join(ROOT, 'turbo.json')),
    workspaces: existsSync(join(ROOT, 'pnpm-workspace.yaml')) || Boolean(pkg?.workspaces),
    husky: existsSync(join(ROOT, '.husky')),
    githubActions: existsSync(join(ROOT, '.github', 'workflows')),
    docker: existsSync(join(ROOT, 'docker-compose.yml')) || existsSync(join(ROOT, 'Dockerfile')),
  };

  // Sub-packages, so a monorepo reports its real surfaces rather than one blurred root.
  const surfaces = [];
  for (const base of ['apps', 'packages', 'libs', 'services']) {
    const dir = join(ROOT, base);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = join(dir, entry.name, 'package.json');
      if (!existsSync(sub)) continue;
      const subPkg = JSON.parse(readFileSync(sub, 'utf8'));
      surfaces.push({
        name: entry.name,
        package: subPkg.name ?? entry.name,
        root: `${base}/${entry.name}`,
        scripts: Object.keys(subPkg.scripts ?? {}),
        testRunner: detectRunner(subPkg),
      });
    }
  }

  const testFiles = [];
  walk(ROOT, (file) => {
    if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(file) || /_test\.go$/.test(file) || /(^|\/)test_[^/]+\.py$/.test(file)) {
      testFiles.push(relative(ROOT, file));
    }
  });

  const report = {
    root: ROOT,
    packageManager,
    rootPackage: pkg?.name ?? null,
    rootScripts: Object.keys(pkg?.scripts ?? {}),
    signals,
    surfaces,
    testFileCount: testFiles.length,
    testFileSample: testFiles.slice(0, 12),
    keelInstalled: existsSync(CONFIG_PATH),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export function detectRunner(pkg) {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const candidate of ['vitest', 'jest', 'mocha', 'ava', '@playwright/test', 'node:test']) {
    if (deps[candidate]) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------- contracts

// The one place a node's shape is written down. The patch scanner in `undeclared`
// reuses it, so the two can never disagree about what a node is.
const NODE_LINE = /^(\s*)[-*]\s+(\[[x ~!]\])\s+(.*)$/;

export function parseContract(file) {
  return parseContractText(readFileSync(file, 'utf8'), relative(ROOT, file));
}

/**
 * The format, separated from the disk. `parseContract` reads a working-tree file;
 * this also parses a blob read out of git, which is how a diff's two sides are
 * compared. Not one regex below has changed in the extraction — `keel.test.mjs`'s
 * parser tests are the proof, and they are unmodified (mental model §6: whatever
 * this accepts *is* the contract format, in every consuming repo at once).
 */
export function parseContractText(text, file) {
  const nodes = [];
  let frontmatter = {};

  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      for (const line of text.slice(4, end).split('\n')) {
        const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
        if (match) frontmatter[match[1]] = match[2].trim();
      }
    }
  }

  const lines = text.split('\n');
  let group = null;
  lines.forEach((line, index) => {
    const heading = /^#{2,}\s+(.*)$/.exec(line);
    if (heading) { group = heading[1].trim(); return; }

    const node = NODE_LINE.exec(line);
    if (!node) return;
    const [, indent, marker, rest] = node;
    const status = STATUS[marker];
    if (!status) return;

    const deferReason = /\((?:deferred|defer):\s*([^)]*)\)/i.exec(rest);
    const brokenReason = /\((?:broken|regression):\s*([^)]*)\)/i.exec(rest);

    nodes.push({
      file,
      line: index + 1,
      depth: Math.floor(indent.replace(/\t/g, '  ').length / 2),
      group,
      status: status.key,
      text: rest.trim(),
      reason: (deferReason?.[1] ?? brokenReason?.[1] ?? '').trim() || null,
    });
  });

  return { file, frontmatter, nodes };
}

const LINT_MAX_WORDS = 40;
const LINT_MAX_CODE_SPANS = 3;

/**
 * Nodes that are not nodes. A gap-marker naming several functions looks like a work
 * queue entry, but no single test can prove it — so it overstates how ready the queue
 * is. Heuristics, deliberately: this flags for a human, it does not fail a build.
 */
export function lintNode(node, { maxWords = LINT_MAX_WORDS, maxCodeSpans = LINT_MAX_CODE_SPANS } = {}) {
  const problems = [];
  // Only identifier-shaped spans count. A node legitimately quotes markers
  // (`- [x]`) and annotations (`(deferred: reason)`) while describing one
  // behaviour; a gap-marker lists *names*, which is the thing worth flagging.
  const codeSpans = (node.text.match(/`[^`]+`/g) ?? [])
    .map((span) => span.slice(1, -1))
    .filter((inner) => /^[.@]?[A-Za-z_$][\w$./-]*$/.test(inner)).length;
  if (codeSpans >= maxCodeSpans) {
    problems.push(`names ${codeSpans} code spans — a node describes one behaviour, and this reads as a list of functions`);
  }
  const words = node.text.split(/\s+/).filter(Boolean).length;
  if (words > maxWords) {
    problems.push(`${words} words — prose rather than a sentence a single test could prove`);
  }
  return problems;
}

function contracts(argv) {
  const config = loadConfig();
  const dir = join(ROOT, config?.contracts ?? 'contracts');
  if (!existsSync(dir)) fail(`no contracts directory at ${relative(ROOT, dir) || dir}. Run the install skill first.`);

  const files = [];
  walk(dir, (file) => { if (file.endsWith('.md') && !file.endsWith('README.md')) files.push(file); });
  files.sort();

  const parsed = files.map(parseContract);
  const all = parsed.flatMap((entry) => entry.nodes);
  const count = (key) => all.filter((node) => node.status === key).length;

  const wantOpen = argv.includes('--open');
  const wantJson = argv.includes('--json');

  if (wantJson) {
    process.stdout.write(`${JSON.stringify({ files: parsed, totals: tally(all) }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`contracts in ${relative(ROOT, dir) || '.'}  (${parsed.length} file${parsed.length === 1 ? '' : 's'}, ${all.length} nodes)\n\n`);
  for (const entry of parsed) {
    const t = tally(entry.nodes);
    const tests = entry.frontmatter.tests ? `  tests: ${entry.frontmatter.tests}` : '  tests: (none declared)';
    process.stdout.write(`  ${entry.file}\n    held ${t.held}  open ${t.open}  deferred ${t.deferred}  broken ${t.broken}\n  ${tests}\n`);
  }
  process.stdout.write(`\n  TOTAL  held ${count('held')}  open ${count('open')}  deferred ${count('deferred')}  broken ${count('broken')}\n`);

  const unexplained = all.filter((node) => (node.status === 'deferred' || node.status === 'broken') && !node.reason);
  if (unexplained.length) {
    process.stdout.write(`\n  ${unexplained.length} node(s) deferred or broken WITHOUT a reason — every one needs one:\n`);
    for (const node of unexplained) process.stdout.write(`    ${node.file}:${node.line}  ${node.text}\n`);
  }

  const wantLint = argv.includes('--lint');
  let lintFindings = 0;
  if (wantLint) {
    const config2 = loadConfig();
    const options = config2?.lint ?? {};
    process.stdout.write('\n  lint — nodes that no single test could prove:\n');
    for (const node of all) {
      const problems = lintNode(node, options);
      if (!problems.length) continue;
      lintFindings += 1;
      process.stdout.write(`    ${node.file}:${node.line}  ${node.text.slice(0, 70)}${node.text.length > 70 ? '…' : ''}\n`);
      for (const problem of problems) process.stdout.write(`      ${problem}\n`);
    }
    if (!lintFindings) process.stdout.write('    none — every node reads as one provable behaviour.\n');
  }

  if (wantOpen) {
    const open = all.filter((node) => node.status === 'open' || node.status === 'broken');
    process.stdout.write(`\n  work queue (${open.length}):\n`);
    for (const node of open) {
      process.stdout.write(`    ${node.file}:${node.line}  [${node.status}] ${node.group ? `${node.group} — ` : ''}${node.text}\n`);
    }
  }

  process.exitCode = unexplained.length || (wantLint && lintFindings) ? 1 : 0;
}

export function tally(nodes) {
  return {
    held: nodes.filter((n) => n.status === 'held').length,
    open: nodes.filter((n) => n.status === 'open').length,
    deferred: nodes.filter((n) => n.status === 'deferred').length,
    broken: nodes.filter((n) => n.status === 'broken').length,
  };
}

// ---------------------------------------------------------------- untested

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** Filename suffix conventions, which say more about risk than line count does. */
export function kindOf(path) {
  const name = path.split('/').pop() ?? path;
  for (const [suffix, kind] of [
    ['.guard.', 'guard'], ['.controller.', 'controller'], ['.service.', 'service'],
    ['.strategy.', 'strategy'], ['.middleware.', 'middleware'], ['.interceptor.', 'interceptor'],
    ['.filter.', 'filter'], ['.pipe.', 'pipe'], ['.resolver.', 'resolver'],
    ['.repository.', 'repository'], ['.util.', 'util'], ['.utils.', 'util'],
    ['.dto.', 'dto'], ['.schema.', 'schema'], ['.config.', 'config'],
    ['.module.', 'wiring'], ['.constants.', 'constants'], ['.types.', 'types'],
    ['.hook.', 'hook'], ['.store.', 'store'], ['.api.', 'client'],
  ]) {
    if (name.includes(suffix)) return kind;
  }
  if (/^use[A-Z]/.test(name)) return 'hook';
  if (/\.(tsx|jsx)$/.test(name)) return 'component';
  if (name.startsWith('index.')) return 'barrel';
  return 'module';
}

/** Carries no behaviour of its own, so an absent test is not a gap. */
export const INERT = new Set(['dto', 'types', 'constants', 'barrel', 'wiring', 'schema']);

function untested(argv) {
  const config = loadConfig();
  const surfaces = config?.surfaces?.length
    ? config.surfaces
    : [{ name: 'repo', root: '.' }];

  // Every test file in the repo, indexed by the basename it appears to cover, so a
  // test living far from its subject still counts.
  const testedNames = new Set();
  let testFileCount = 0;
  walk(ROOT, (file) => {
    if (!TEST_FILE.test(file)) return;
    testFileCount += 1;
    const base = (file.split('/').pop() ?? '').replace(TEST_FILE, '');
    testedNames.add(base);
  });

  // Pairing is by basename, so two files of the same name in different directories
  // share one answer. Counted here rather than left as folklore in the mental model.
  const basenameCounts = new Map();

  const report = [];
  for (const surface of surfaces) {
    const root = join(ROOT, surface.root);
    if (!existsSync(root)) continue;
    const files = [];
    walk(root, (file) => {
      if (!SOURCE_EXT.test(file) || TEST_FILE.test(file)) return;
      if (file.endsWith('.d.ts')) return;
      // Generated output is not hand-written behaviour.
      if (/\.(gen|generated)\.[cm]?[jt]sx?$/.test(file)) return;
      const rel = relative(ROOT, file);
      // Test scaffolding and generated SQL are not product source.
      for (const segment of ['dist', 'migrations', 'test', 'tests', '__tests__', '__mocks__', 'e2e', 'fixtures']) {
        if (rel.split(sep).includes(segment)) return;
      }
      const base = (file.split('/').pop() ?? '').replace(SOURCE_EXT, '');
      basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1);
      if (testedNames.has(base)) return;
      const text = readFileSync(file, 'utf8');
      files.push({
        file: rel,
        loc: text.split('\n').filter((line) => line.trim() && !line.trim().startsWith('//')).length,
        kind: kindOf(rel),
        exports: (text.match(/^export /gm) ?? []).length,
      });
    });
    const behavioural = files.filter((f) => !INERT.has(f.kind));
    behavioural.sort((a, b) => b.loc - a.loc);
    report.push({
      surface: surface.name,
      root: surface.root,
      untested: behavioural,
      inertSkipped: files.length - behavioural.length,
    });
  }

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ testFileCount, surfaces: report }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`untested source files  (${testFileCount} test files found repo-wide)\n`);
  process.stdout.write(`inert kinds (dto, types, constants, barrels, DI wiring, schema) are excluded — they carry no behaviour\n`);
  const collisions = [...basenameCounts.values()].filter((count) => count > 1).length;
  if (collisions) {
    process.stdout.write(`${collisions} name(s) share a basename across directories — a test for either marks both tested, so this list reads short\n`);
  }
  for (const entry of report) {
    const total = entry.untested.reduce((sum, f) => sum + f.loc, 0);
    process.stdout.write(`\n  ${entry.surface} (${entry.root}) — ${entry.untested.length} untested, ${total} loc, ${entry.inertSkipped} inert skipped\n`);
    for (const f of entry.untested.slice(0, 40)) {
      process.stdout.write(`    ${String(f.loc).padStart(5)} loc  ${f.kind.padEnd(11)} ${f.file}\n`);
    }
    if (entry.untested.length > 40) {
      process.stdout.write(`    ... and ${entry.untested.length - 40} more (use --json for all)\n`);
    }
  }
  process.stdout.write('\nLine count is a proxy for nothing. Rank these by what breaks if they are wrong.\n');
}

// ---------------------------------------------------------------- model

const MODEL_SECTIONS = [
  ['what this system is for', 'purpose and who it serves'],
  ['vocabulary', 'domain nouns, especially the dangerously similar ones'],
  ['invariants', 'truths no change may violate'],
  ['the shape', 'layers and the allowed direction of dependency'],
  ['decisions', 'load-bearing choices and the reasons behind them'],
  ['sharp edges', 'what is fragile, and what to read first'],
  ['deliberately does not do', 'scope boundaries'],
];

const MODEL_SOFT_LIMIT = 200;

function modelPath() {
  const config = loadConfig();
  return join(ROOT, config?.mentalModel ?? 'MENTAL_MODEL.md');
}

/** Structural check only. Whether the content is *true* is the agent's problem. */
export function inspectModel() {
  const file = modelPath();
  if (!existsSync(file)) return { missing: true, file: relative(ROOT, file) };

  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const headings = lines
    .filter((line) => /^#{1,3}\s/.test(line))
    .map((line) => line.replace(/^#+\s*/, '').toLowerCase());

  const missing = MODEL_SECTIONS.filter(
    ([key]) => !headings.some((heading) => heading.includes(key)),
  );
  const unknowns = (text.match(/^\s*>\s*UNKNOWN:/gim) ?? []).length;

  return {
    file: relative(ROOT, file),
    lines: lines.length,
    overLimit: lines.length > MODEL_SOFT_LIMIT,
    sections: MODEL_SECTIONS.length - missing.length,
    missing,
    unknowns,
    imported: importedByConventions(),
  };
}

/** The model only steers if something pulls it into context automatically. */
function importedByConventions() {
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const file = join(ROOT, name);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/^@[^\s]*MENTAL_MODEL\.md/m.test(text)) return name;
  }
  return null;
}

function model() {
  const report = inspectModel();
  if (report.missing === true) {
    process.stdout.write(`keel model — no mental model at ${report.file}\n\nRun /keel:install or /keel:bootstrap to create one.\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`keel model — ${report.file}\n\n`);
  process.stdout.write(`  ${report.sections}/${MODEL_SECTIONS.length} sections present\n`);
  process.stdout.write(`  ${report.lines} lines (soft limit ${MODEL_SOFT_LIMIT})\n`);
  process.stdout.write(`  ${report.unknowns} recorded unknown${report.unknowns === 1 ? '' : 's'}\n`);
  process.stdout.write(
    report.imported
      ? `  imported by ${report.imported}, so it reaches context automatically\n`
      : `  NOT imported by CLAUDE.md or AGENTS.md — nothing pulls it into context\n`,
  );

  const problems = [];
  for (const [key, blurb] of report.missing) {
    problems.push(`missing section "${key}" — ${blurb}`);
  }
  if (report.overLimit) {
    problems.push(`${report.lines} lines is past the ${MODEL_SOFT_LIMIT}-line soft limit — it has probably absorbed material belonging in code, contracts, or CLAUDE.md`);
  }
  if (!report.imported) {
    problems.push('add a line `@MENTAL_MODEL.md` to CLAUDE.md (or AGENTS.md) so it is always in context');
  }

  if (problems.length) {
    process.stdout.write('\n');
    for (const problem of problems) process.stdout.write(`  FAIL  ${problem}\n`);
    process.stdout.write(`\n${problems.length} problem(s).\n`);
  } else {
    process.stdout.write('\nhealthy.\n');
  }
  process.exitCode = problems.length ? 1 : 0;
}

// ---------------------------------------------------------------- unknowns

const UNKNOWN_DEFAULT_PATHS = ['MENTAL_MODEL.md', 'contracts', 'docs'];
const UNKNOWN_DEFAULT_MAX_AGE = 30;

/**
 * An unknown is a blockquote that opens with `> UNKNOWN:` and runs until the
 * blockquote ends, so a multi-line question stays one item.
 */
export function collectUnknowns() {
  const config = loadConfig();
  const roots = config?.unknowns?.paths ?? UNKNOWN_DEFAULT_PATHS;

  const files = [];
  for (const entry of roots) {
    const full = join(ROOT, entry);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) walk(full, (file) => { if (file.endsWith('.md')) files.push(file); });
    else files.push(full);
  }
  files.sort();

  const found = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^\s*>\s*UNKNOWN:/i.test(lines[index])) continue;
      const parts = [lines[index].replace(/^\s*>\s*UNKNOWN:\s*/i, '')];
      let cursor = index + 1;
      while (cursor < lines.length && /^\s*>/.test(lines[cursor]) && !/^\s*>\s*UNKNOWN:/i.test(lines[cursor])) {
        parts.push(lines[cursor].replace(/^\s*>\s*/, ''));
        cursor += 1;
      }
      found.push({
        file: relative(ROOT, file),
        line: index + 1,
        question: parts.join(' ').replace(/\s+/g, ' ').trim(),
        section: sectionAt(lines, index),
        ageDays: blameAgeDays(file, index + 1),
      });
      index = cursor - 1;
    }
  }
  return found;
}

/** Nearest preceding heading — the domain the question belongs to. */
export function sectionAt(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const heading = /^#{1,4}\s+(.*)$/.exec(lines[cursor]);
    if (heading) return heading[1].trim();
  }
  return null;
}

/**
 * Age comes from git blame, so nobody has to remember to date an unknown.
 * Returns null when the line is not committed yet (or git is unavailable).
 */
function blameAgeDays(file, line) {
  try {
    const out = execFileSync(
      'git',
      ['blame', '-L', `${line},${line}`, '--porcelain', '--', file],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const stamp = /^author-time (\d+)$/m.exec(out);
    if (!stamp) return null;
    const seconds = Number(stamp[1]);
    return Math.floor((Date.now() / 1000 - seconds) / 86400);
  } catch {
    return null;
  }
}

function unknowns(argv) {
  const config = loadConfig();
  const maxAge = config?.unknowns?.maxAgeDays ?? UNKNOWN_DEFAULT_MAX_AGE;
  const found = collectUnknowns();

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ maxAgeDays: maxAge, unknowns: found }, null, 2)}\n`);
    process.exitCode = found.some((u) => (u.ageDays ?? 0) > maxAge) ? 1 : 0;
    return;
  }

  if (!found.length) {
    process.stdout.write('no recorded unknowns.\n\nThat is either a well-understood project or an under-questioned one.\n');
    return;
  }

  const stale = found.filter((u) => (u.ageDays ?? 0) > maxAge);
  process.stdout.write(`${found.length} unanswered question${found.length === 1 ? '' : 's'} (stale after ${maxAge} days)\n\n`);

  for (const item of found) {
    const age = item.ageDays === null ? 'uncommitted' : `${item.ageDays}d`;
    const flag = (item.ageDays ?? 0) > maxAge ? ' STALE' : '';
    process.stdout.write(`  ${item.file}:${item.line}  [${age}]${flag}\n`);
    if (item.section) process.stdout.write(`    under: ${item.section}\n`);
    process.stdout.write(`    ${item.question}\n\n`);
  }

  if (stale.length) {
    process.stdout.write(`${stale.length} of these have gone unanswered for more than ${maxAge} days.\n`);
    process.stdout.write('Ask the operator now, or record why the question can wait.\n');
  }
  process.exitCode = stale.length ? 1 : 0;
}

// ---------------------------------------------------------------- mutation

/**
 * Reads Stryker's JSON report rather than its console output, so a score is a
 * fact read off disk instead of a number an agent recalls.
 */
export function readMutationReport(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const tally = { killed: 0, timeout: 0, survived: 0, noCoverage: 0, ignored: 0, error: 0 };
  const weakest = [];

  for (const [name, entry] of Object.entries(data.files ?? {})) {
    const local = { killed: 0, timeout: 0, survived: 0, noCoverage: 0 };
    for (const mutant of entry.mutants ?? []) {
      switch (mutant.status) {
        case 'Killed': tally.killed += 1; local.killed += 1; break;
        case 'Timeout': tally.timeout += 1; local.timeout += 1; break;
        case 'Survived': tally.survived += 1; local.survived += 1; break;
        case 'NoCoverage': tally.noCoverage += 1; local.noCoverage += 1; break;
        case 'Ignored': tally.ignored += 1; break;
        default: tally.error += 1; break;
      }
    }
    const denominator = local.killed + local.timeout + local.survived + local.noCoverage;
    if (denominator) {
      weakest.push({ file: name, score: ((local.killed + local.timeout) / denominator) * 100, mutants: denominator });
    }
  }

  const denominator = tally.killed + tally.timeout + tally.survived + tally.noCoverage;
  const covered = tally.killed + tally.timeout + tally.survived;
  weakest.sort((a, b) => a.score - b.score || b.mutants - a.mutants);

  return {
    score: denominator ? ((tally.killed + tally.timeout) / denominator) * 100 : null,
    coveredScore: covered ? ((tally.killed + tally.timeout) / covered) * 100 : null,
    tally,
    weakest: weakest.slice(0, 10),
  };
}

function mutation(argv) {
  const config = loadConfig();
  const settings = config?.mutation;
  if (!settings?.reports?.length) {
    fail('no mutation reports configured. Add `mutation.reports` to .keel/config.json.');
  }
  const threshold = settings.threshold ?? 70;

  const results = [];
  for (const report of settings.reports) {
    const file = join(ROOT, report.file);
    if (!existsSync(file)) {
      results.push({ surface: report.surface, missing: report.file });
      continue;
    }
    results.push({ surface: report.surface, file: report.file, ...readMutationReport(file) });
  }

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({ threshold, results }, null, 2)}\n`);
  } else {
    process.stdout.write(`mutation score (threshold ${threshold}%)\n\n`);
    for (const result of results) {
      if (result.missing) {
        process.stdout.write(`  ${result.surface}: no report at ${result.missing} — has Stryker been run?\n`);
        continue;
      }
      const baseline = settings.baseline?.[result.surface];
      const verdict = result.score >= threshold ? 'pass' : 'below target';
      process.stdout.write(`  ${result.surface}: ${result.score.toFixed(2)}%  (${verdict} — target ${threshold}%)\n`);
      if (typeof baseline === 'number') {
        const delta = result.score - baseline;
        const direction = delta >= 0 ? 'up' : 'DOWN';
        process.stdout.write(`    ratchet: baseline ${baseline.toFixed(2)}% → ${direction} ${Math.abs(delta).toFixed(2)} points\n`);
      }
      const ceiling = result.tally.killed + result.tally.timeout + result.tally.survived + result.tally.noCoverage;
      if (ceiling) {
        process.stdout.write(`    ceiling today ${(((ceiling - result.tally.noCoverage) / ceiling) * 100).toFixed(2)}% — no threshold above this is reachable until untested files get tests\n`);
      }
      process.stdout.write(`    covered-only ${result.coveredScore.toFixed(2)}%  —  killed ${result.tally.killed}, timeout ${result.tally.timeout}, survived ${result.tally.survived}, no coverage ${result.tally.noCoverage}\n`);
      if (result.weakest.length) {
        process.stdout.write('    weakest files:\n');
        for (const item of result.weakest.slice(0, 5)) {
          process.stdout.write(`      ${item.score.toFixed(0).padStart(3)}%  ${item.file.replace(`${ROOT}/`, '')} (${item.mutants} mutants)\n`);
        }
      }
    }
    process.stdout.write('\nA score is a fact read from the report, not a claim. The survivors are the interesting part.\n');
  }

  // A full-suite score below the target is expected on a repo with untested areas and
  // is not a failure. Regressing below the recorded baseline is.
  const tolerance = settings.ratchetTolerance ?? 0.5;
  const regressed = results.filter((r) => {
    const baseline = settings.baseline?.[r.surface];
    return !r.missing && typeof baseline === 'number' && r.score < baseline - tolerance;
  });
  if (regressed.length) {
    process.stdout.write('\n');
    for (const r of regressed) {
      process.stdout.write(`  RATCHET BROKEN  ${r.surface} fell from ${settings.baseline[r.surface].toFixed(2)}% to ${r.score.toFixed(2)}%\n`);
    }
  }
  process.exitCode = regressed.length ? 1 : 0;
}

// ---------------------------------------------------------------- mutate

/**
 * Whether a mutation is unambiguous, and what it produces. Pure: the decision to
 * refuse happens before anything touches disk, because an ambiguous mutation
 * silently tests something other than what was meant.
 */
export function planMutation({ text, find, replace }) {
  if (!find) return { ok: false, reason: 'empty-find', count: 0 };
  const count = text.split(find).length - 1;
  if (count === 0) return { ok: false, reason: 'not-found', count };
  if (count > 1) return { ok: false, reason: 'ambiguous', count };
  return { ok: true, count, mutated: text.replace(find, replace) };
}

/**
 * A mutant is killed when the command FAILED against it — a test noticed. A command
 * that passes means nothing pinned the behaviour, which is the finding.
 */
export function verdictFor(commandStatus) {
  const killed = commandStatus !== 0;
  return {
    killed,
    label: killed ? 'killed' : 'survived',
    exitCode: killed ? 0 : 1,
  };
}

function mutate(argv) {
  const separator = argv.indexOf('--');
  const flags = separator === -1 ? argv : argv.slice(0, separator);
  const command = separator === -1 ? [] : argv.slice(separator + 1);

  const valueOf = (name) => {
    const at = flags.indexOf(name);
    return at === -1 ? undefined : flags[at + 1];
  };
  const target = flags.find((token) => !token.startsWith('--') &&
    flags[flags.indexOf(token) - 1] !== '--find' &&
    flags[flags.indexOf(token) - 1] !== '--replace');
  const find = valueOf('--find');
  const replace = valueOf('--replace') ?? '';

  if (!target) fail('mutate needs a file: keel mutate <file> --find <literal> --replace <literal> -- <command>');
  if (find === undefined) fail('mutate needs --find <literal>');
  if (!command.length) fail('mutate needs a command after `--` to run against the mutation');

  const file = join(ROOT, target);
  if (!existsSync(file)) fail(`no such file: ${target}`);

  const original = readFileSync(file, 'utf8');
  const plan = planMutation({ text: original, find, replace });
  if (!plan.ok) {
    const explain = {
      'empty-find': '--find cannot be empty',
      'not-found': `--find string does not occur in ${target} — nothing to mutate`,
      'ambiguous': `--find string occurs ${plan.count} times in ${target}; it must occur exactly once, or the mutation tests something other than what you meant`,
    };
    fail(`${explain[plan.reason]}\n       Nothing was written.`);
  }

  // Outside the repository on purpose: a `git clean` between mutation and restore
  // must not be able to defeat the snapshot.
  const snapshotDir = mkdtempSync(join(tmpdir(), 'keel-mutate-'));
  const snapshot = join(snapshotDir, target.split('/').pop());
  writeFileSync(snapshot, original);

  let restored = false;
  const restore = () => {
    if (restored) return;
    writeFileSync(file, readFileSync(snapshot, 'utf8'));
    if (readFileSync(file, 'utf8') !== original) {
      process.stderr.write(`keel: RESTORE FAILED for ${target}. The original is at ${snapshot} — recover it by hand before doing anything else.\n`);
      process.exit(2);
    }
    restored = true;
    rmSync(snapshotDir, { recursive: true, force: true });
  };
  // Even an interrupted run puts the file back.
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { restore(); process.exit(130); });

  let status;
  try {
    writeFileSync(file, plan.mutated);
    process.stdout.write(`keel mutate — ${target}\n  ${JSON.stringify(find)} -> ${JSON.stringify(replace)}\n  running: ${command.join(' ')}\n\n`);
    status = spawnSync(command[0], command.slice(1), { cwd: ROOT, stdio: 'inherit' }).status ?? 1;
  } finally {
    restore();
  }

  const verdict = verdictFor(status);
  process.stdout.write(
    verdict.killed
      ? `\nMUTANT KILLED — the command failed against the mutation, so a test caught it.\n  ${target} restored, verified byte-identical.\n`
      : `\nMUTANT SURVIVED — the command passed against the mutation. Nothing pins this behaviour: it is a missing test, or an equivalent mutant deserving a reasoned disable.\n  ${target} restored, verified byte-identical.\n`,
  );
  process.exitCode = verdict.exitCode;
}

// ---------------------------------------------------------------- ledger

/**
 * One ledger line. Fields render as a bracketed prefix so a line stays readable as
 * prose; a bare entry renders exactly as it always has, because every consuming
 * repo already holds ledgers written without them.
 */
export function formatLedgerEntry({ stamp, phase, fields = {}, note }) {
  const pairs = Object.entries(fields).filter(([, value]) => value !== undefined && value !== '');
  // Two spaces, matching the separator the rest of the line uses.
  const prefix = pairs.length ? `(${pairs.map(([k, v]) => `${k}: ${v}`).join('; ')})  ` : '';
  return `- ${stamp}  **${phase.toUpperCase()}**  ${prefix}${note}`;
}

/**
 * Reads a line back. Entries written before fields existed parse the same way, with
 * no fields — formats stay backward-compatible across 0.x in both directions.
 */
export function parseLedgerEntry(line) {
  const match = /^-\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s+\*\*([A-Z]+)\*\*\s+(.*)$/.exec(line);
  if (!match) return null;
  const [, stamp, phase, remainder] = match;
  const fields = {};
  let note = remainder;
  const fieldMatch = /^\(([^)]*)\)\s+([\s\S]*)$/.exec(remainder);
  if (fieldMatch && /^[a-z][\w-]*:/.test(fieldMatch[1].trim())) {
    for (const pair of fieldMatch[1].split(';')) {
      const [key, ...rest] = pair.split(':');
      if (rest.length) fields[key.trim()] = rest.join(':').trim();
    }
    note = fieldMatch[2];
  }
  return { stamp, phase: phase.toLowerCase(), fields, note };
}

function ledgerEntries() {
  const file = join(ROOT, '.keel', 'ledger.md');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map(parseLedgerEntry)
    .filter(Boolean);
}

function ledger(argv) {
  // No arguments at all reads the ledger back, rather than failing at someone who
  // typed `keel ledger` to see what is in it.
  if (!argv.length || argv[0] === '--json') {
    const entries = ledgerEntries();
    if (argv[0] === '--json') {
      process.stdout.write(`${JSON.stringify({ entries }, null, 2)}\n`);
      return;
    }
    if (!entries.length) {
      process.stdout.write('no ledger entries yet.\n');
      return;
    }
    process.stdout.write(`${entries.length} ledger entries — most recent last\n\n`);
    for (const entry of entries.slice(-10)) {
      const fields = Object.entries(entry.fields).map(([k, v]) => `${k}=${v}`).join(' ');
      process.stdout.write(`  ${entry.stamp}  ${entry.phase.toUpperCase().padEnd(8)} ${fields ? `${fields}  ` : ''}${entry.note.slice(0, 90)}${entry.note.length > 90 ? '…' : ''}\n`);
    }
    return;
  }

  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--domain' || argv[i] === '--nodes') {
      flags[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  const [phase, ...rest] = positional;
  const note = rest.join(' ').trim();
  const phases = ['contract', 'plan', 'tdd', 'verify', 'review', 'note'];
  if (!phase || !phases.includes(phase.toLowerCase())) {
    fail(`ledger needs a phase (${phases.join(', ')}) and a note. Got: ${argv.join(' ') || '(nothing)'}`);
  }
  if (!note) fail('ledger needs a note describing what actually happened.');

  const dir = join(ROOT, '.keel');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'ledger.md');
  if (!existsSync(file)) {
    writeFileSync(file, '# Keel ledger\n\nAppend-only record of which gates each change actually passed.\n\n');
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  appendFileSync(file, `${formatLedgerEntry({ stamp, phase, fields: flags, note })}\n`);
  process.stdout.write(`recorded in ${relative(ROOT, file)}\n`);
}

// ---------------------------------------------------------------- doctor

/**
 * The in-repo scripts a command actually runs. `pnpm test` names none; `node
 * scripts/gate.mjs --base main` names one. Guessing a filename from a package
 * script would be worse than saying nothing.
 */
export function scriptsNamedIn(command) {
  return (command.match(/[\w./-]+\.(mjs|cjs|js|ts)\b/g) ?? [])
    .filter((token) => !token.startsWith('-'));
}

/**
 * Invariant 5, made mechanical: a gate's own tooling is itself gated. Returns the
 * scripts a config runs that nothing appears to test.
 */
export function untestedTooling(commands, { exists, isTested }) {
  const found = [];
  for (const [name, command] of Object.entries(commands ?? {})) {
    for (const script of scriptsNamedIn(String(command))) {
      if (!exists(script)) continue;
      if (isTested(script)) continue;
      found.push({ command: name, script });
    }
  }
  return found;
}

// Where a repo actually wires a gate. A heuristic over known locations, which is why
// the warning names them: a repo wiring it elsewhere deserves to see the alarm is false.
export const GATE_WIRING_PLACES = [
  '.github/workflows', '.husky', '.git/hooks', '.circleci',
  '.gitlab-ci.yml', 'package.json', '.keel/config.json', '.claude/settings.json',
];

/** The version of this engine that first carried `undeclared`. */
const GATE_SINCE = '0.4.0';

/**
 * A gate installed and never run is the failure the gate exists to catch, one layer
 * up — 86 browser tests wired to nothing for three weeks, on the first repo this was
 * measured against. A warning, never a FAIL: doctor's exit code is an API
 * (invariant 3), and a repo that chose not to wire it must still reach a clean doctor.
 */
export function unwiredGateWarning({ wired, vendoredPresent = false, vendoredVersion = null, places = GATE_WIRING_PLACES }) {
  if (wired) return null;
  if (vendoredPresent && (vendoredVersion === null || compareVersions(vendoredVersion, GATE_SINCE) < 0)) return null;
  return `nothing invokes \`undeclared\` — looked in ${places.join(', ')}. The gate is installed and never runs.`;
}

/** Every text a wiring place offers, flattened. Directories are read one level deep. */
function wiringTexts() {
  const texts = [];
  for (const place of GATE_WIRING_PLACES) {
    const full = join(ROOT, place);
    if (!existsSync(full)) continue;
    if (statSync(full).isDirectory()) {
      walk(full, (file) => texts.push(readIfPresent(file) ?? ''), { skip: new Set(['node_modules']) });
    } else {
      texts.push(readIfPresent(full) ?? '');
    }
  }
  return texts;
}

function doctor() {
  const problems = [];
  const notes = [];
  const warnings = [];

  const config = loadConfig();
  if (!config) problems.push('no .keel/config.json — this project has not been installed yet');

  if (config) {
    const dir = join(ROOT, config.contracts ?? 'contracts');
    if (!existsSync(dir)) problems.push(`contracts directory missing: ${config.contracts ?? 'contracts'}`);
    const commands = config.commands ?? {};
    for (const required of ['test', 'lint']) {
      if (!commands[required]) problems.push(`config.commands.${required} is not set — verify cannot prove anything without it`);
    }
    for (const [name, command] of Object.entries(commands)) notes.push(`command.${name}: ${command}`);
    for (const surface of config.surfaces ?? []) {
      if (!existsSync(join(ROOT, surface.root))) problems.push(`surface "${surface.name}" points at a missing path: ${surface.root}`);
    }
  }

  const modelReport = inspectModel();
  if (modelReport.missing === true) {
    problems.push(`no mental model at ${modelReport.file} — run /keel:install to create one`);
  } else {
    notes.push(`mental model: ${modelReport.sections}/${MODEL_SECTIONS.length} sections, ${modelReport.lines} lines, ${modelReport.unknowns} unknown(s)`);
    if (modelReport.missing.length) problems.push(`mental model missing ${modelReport.missing.length} section(s) — run \`keel model\` for the list`);
    if (modelReport.overLimit) problems.push(`mental model is ${modelReport.lines} lines, past the ${MODEL_SOFT_LIMIT}-line soft limit`);
    if (!modelReport.imported) problems.push('mental model is not imported by CLAUDE.md or AGENTS.md — nothing pulls it into context');
  }

  // Invariant 5: the thing that decides whether everything else is tested does not
  // get to be untested itself. A warning, never a FAIL — this is debt to schedule,
  // not a broken install.
  if (config?.commands) {
    const testedNames = new Set();
    walk(ROOT, (file) => {
      if (!TEST_FILE.test(file)) return;
      testedNames.add((file.split('/').pop() ?? '').replace(TEST_FILE, ''));
    });
    const untestedScripts = untestedTooling(config.commands, {
      exists: (script) => existsSync(join(ROOT, script)),
      isTested: (script) => testedNames.has((script.split('/').pop() ?? '').replace(SOURCE_EXT, '')),
    });
    for (const item of untestedScripts) {
      warnings.push(`command.${item.command} runs ${item.script}, which nothing tests — a gate that decides whether other code is tested should not be untested itself`);
    }
  }

  if (config && !config.review?.model) {
    warnings.push('review.model is not set — /keel:review falls back to a self-pass, and an author reviewing their own work reads their intentions back into it');
  }

  const openQuestions = collectUnknowns();
  const maxAge = config?.unknowns?.maxAgeDays ?? UNKNOWN_DEFAULT_MAX_AGE;
  const staleQuestions = openQuestions.filter((u) => (u.ageDays ?? 0) > maxAge);
  notes.push(`unknowns: ${openQuestions.length} unanswered`);
  if (staleQuestions.length) {
    problems.push(`${staleQuestions.length} unknown(s) unanswered for more than ${maxAge} days — run \`keel unknowns\``);
  }

  // The vendored copy is what CI runs. Nothing else in doctor looks at it, so a repo
  // could sit on a fork of the engine indefinitely without anything saying so.
  const gateWarning = unwiredGateWarning({
    wired: wiringTexts().some((text) => /\bundeclared\b/.test(text)),
    vendoredPresent: existsSync(VENDORED_PATH),
    vendoredVersion: parseEngineVersion(readIfPresent(VENDORED_PATH)),
  });
  if (gateWarning) warnings.push(gateWarning);

  for (const warning of vendoredWarnings({
    runningVersion: KEEL_VERSION,
    runningSource: readIfPresent(ENGINE_PATH),
    vendoredSource: readIfPresent(VENDORED_PATH),
  })) warnings.push(warning);

  const drift = manifestWarning({
    engineVersion: KEEL_VERSION,
    manifestVersion: manifestVersionBesideEngine(),
  });
  if (drift) warnings.push(drift);

  if (existsSync(join(ROOT, '.keel', 'ledger.md'))) {
    const lines = readFileSync(join(ROOT, '.keel', 'ledger.md'), 'utf8').split('\n').filter((l) => l.startsWith('- '));
    notes.push(`ledger: ${lines.length} entries, last was ${lines.at(-1)?.slice(2) ?? 'none'}`);
  } else {
    notes.push('ledger: empty (no gates recorded yet)');
  }

  process.stdout.write(`keel doctor — ${ROOT}\n\n`);
  for (const note of notes) process.stdout.write(`  ok    ${note}\n`);
  for (const warning of warnings) process.stdout.write(`  warn  ${warning}\n`);
  for (const problem of problems) process.stdout.write(`  FAIL  ${problem}\n`);
  process.stdout.write(problems.length ? `\n${problems.length} problem(s).\n` : '\nhealthy.\n');
  process.exitCode = problems.length ? 1 : 0;
}

// ---------------------------------------------------------------- version

/**
 * The version a copy of this engine declares. A vendored copy predating this
 * feature declares nothing, which is a fact about it rather than an error.
 */
export function parseEngineVersion(source) {
  if (typeof source !== 'string') return null;
  const match = /(?:export\s+)?const\s+KEEL_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(source);
  return match ? match[1] : null;
}

/** Numeric, not lexical: 0.10.0 is after 0.2.0. Missing components count as zero. */
export function compareVersions(a, b) {
  const parts = (value) => String(value ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta) return delta < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * What the copy at .keel/keel.mjs is, relative to the engine doing the asking.
 *
 * Byte equality is checked before versions, which is what makes `forked` detectable
 * at all — and what keeps the engine silent when it *is* the vendored copy, since a
 * vendored engine cannot know whether a newer plugin exists.
 */
export function vendoredState({ runningVersion, runningSource, vendoredSource, runningIsVendored = false }) {
  if (typeof vendoredSource !== 'string') return { state: 'none', vendoredVersion: null };
  const vendoredVersion = parseEngineVersion(vendoredSource);
  // Running as the vendored copy is not a match, it is an absence of evidence.
  if (runningIsVendored) return { state: 'self', vendoredVersion };
  if (typeof runningSource === 'string' && vendoredSource === runningSource) {
    return { state: 'same', vendoredVersion };
  }
  if (vendoredVersion === null) return { state: 'behind', vendoredVersion: null };
  const order = compareVersions(vendoredVersion, runningVersion);
  if (order < 0) return { state: 'behind', vendoredVersion };
  if (order > 0) return { state: 'ahead', vendoredVersion };
  return { state: 'forked', vendoredVersion };
}

/** Warnings, never problems: a stale copy is debt to schedule, not a broken install. */
export function vendoredWarnings({ runningVersion, runningSource, vendoredSource, runningIsVendored = false }) {
  const { state, vendoredVersion } = vendoredState({ runningVersion, runningSource, vendoredSource, runningIsVendored });
  const named = vendoredVersion ?? 'from before the engine carried a version';
  switch (state) {
    case 'behind':
      return [`vendored .keel/keel.mjs is ${named}; this engine is ${runningVersion} — re-vendor it in its own commit (/keel:update)`];
    case 'forked':
      return [`vendored .keel/keel.mjs claims ${vendoredVersion} but differs from this engine byte-for-byte — somebody edited it by hand, which fixes one repo and silently forks the engine (/keel:update)`];
    case 'ahead':
      return [`vendored .keel/keel.mjs is ${vendoredVersion}, ahead of this engine at ${runningVersion} — the plugin is the stale one here, so update it before re-vendoring anything`];
    default:
      return [];
  }
}

/** The release chore spans two files now. This is the only thing that notices. */
export function manifestWarning({ engineVersion, manifestVersion }) {
  if (!manifestVersion || manifestVersion === engineVersion) return null;
  return `plugin manifest declares ${manifestVersion} but this engine declares ${engineVersion} — one of the two was not bumped, and every staleness report is wrong until they agree`;
}

function readIfPresent(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** The manifest beside the running engine. A vendored copy has none, and that is fine. */
function manifestVersionBesideEngine() {
  const file = join(dirname(dirname(ENGINE_PATH)), '.claude-plugin', 'plugin.json');
  const text = readIfPresent(file);
  if (text === null) return null;
  try {
    return JSON.parse(text).version ?? null;
  } catch {
    return null;
  }
}

function version(argv) {
  const runningSource = readIfPresent(ENGINE_PATH);
  const vendoredSource = readIfPresent(VENDORED_PATH);
  const { state, vendoredVersion } = vendoredState({
    runningVersion: KEEL_VERSION,
    runningSource,
    vendoredSource,
    runningIsVendored: samePath(ENGINE_PATH, VENDORED_PATH),
  });

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      running: KEEL_VERSION,
      vendored: vendoredVersion,
      state,
      engine: ENGINE_PATH,
      vendoredPath: vendoredSource === null ? null : relative(ROOT, VENDORED_PATH),
    }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`keel ${KEEL_VERSION}  (running from ${ENGINE_PATH})\n`);
  if (state === 'self') {
    process.stdout.write('  this IS the vendored copy — a file compared against itself proves nothing about\n');
    process.stdout.write('  whether the plugin has moved on. To find that out, run the plugin\'s engine:\n');
    process.stdout.write('    node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" version\n');
    return;
  }
  if (state === 'none') {
    process.stdout.write('  no vendored copy at .keel/keel.mjs — skills run this engine; CI needs a vendored one\n');
    return;
  }
  const label = {
    same: 'current',
    behind: 'behind; re-vendor with /keel:update',
    ahead: 'ahead of this engine; the plugin is the stale one',
    forked: 'same version, different bytes — edited by hand',
  }[state];
  process.stdout.write(`  vendored .keel/keel.mjs: ${vendoredVersion ?? 'no version declared'} — ${label}\n`);
}

// ---------------------------------------------------------------- undeclared

// `untested` finds source with no test. This finds a *change* with no node — the
// failure invariant 1 forbids and nothing until now could see. Measured on the first
// consuming repo: 103 of 151 post-contract behaviour pull requests changed no
// contract file at all, and 94 of those added tests.

const NODE_KEY_SEP = ' ';

/** A node's identity for "did it move". Re-wording is a removal plus an addition. */
export function nodeKey(node) {
  return `${node.file}${NODE_KEY_SEP}${node.text}`;
}

/**
 * Added, removed, or status-changed. Prose, headings and comments inside a contract
 * file are not nodes, so editing them moves nothing — which is the whole reason this
 * compares parsed nodes rather than changed files.
 */
export function movedNodes(before, after) {
  const was = new Map(before.map((node) => [nodeKey(node), node]));
  const now = new Map(after.map((node) => [nodeKey(node), node]));

  const added = after.filter((node) => !was.has(nodeKey(node)));
  const removed = before.filter((node) => !now.has(nodeKey(node)));
  const changed = after.filter((node) => {
    const previous = was.get(nodeKey(node));
    return previous && previous.status !== node.status;
  });
  return { added, removed, changed };
}

/**
 * Nodes added or removed at any commit in a range, read off `git log -p`.
 *
 * Comparing the two endpoints alone misses the shape the contract explicitly blesses:
 * marking a node `[!]` and fixing it in the same branch leaves the file identical at
 * both ends, so endpoint comparison reads it as no movement at all — which would fail
 * the gate on precisely the disciplined bug fix.
 */
export function movedInPatch(patch, { contractsDir = 'contracts' } = {}) {
  const moved = [];
  let file = null;
  for (const line of String(patch ?? '').split('\n')) {
    const header = /^\+\+\+ b\/(.*)$/.exec(line);
    if (header) { file = header[1].trim(); continue; }
    if (!file || !file.startsWith(`${contractsDir}/`) || file.endsWith('README.md')) continue;
    if (!/^[+-]/.test(line) || /^(\+\+\+|---)/.test(line)) continue;
    const node = NODE_LINE.exec(line.slice(1));
    if (!node || !STATUS[node[2]]) continue;
    moved.push({ file, status: STATUS[node[2]].key, text: node[3].trim() });
  }
  return moved;
}

/** Longest root first, so `apps/web` wins over `apps` in a monorepo. */
export function attributeToSurface(path, surfaces) {
  const ranked = [...surfaces].sort((a, b) => (b.root ?? '').length - (a.root ?? '').length);
  for (const surface of ranked) {
    const root = (surface.root ?? '').replace(/\/+$/, '');
    if (!root || root === '.') return surface.name;
    if (path === root || path.startsWith(`${root}/`)) return surface.name;
  }
  return null;
}

/**
 * Which contract file answers for which surface. Frontmatter `surface` or `tests`
 * pointing into a surface's root ties it there; a contract naming neither is
 * repo-wide and answers for every surface.
 */
export function contractCoversSurface(frontmatter, surface) {
  const root = (surface.root ?? '').replace(/\/+$/, '');
  const claims = [frontmatter?.surface, frontmatter?.tests].filter(Boolean);
  if (!claims.length) return true;
  if (!root || root === '.') return true;
  return claims.some((claim) => claim === root || claim.startsWith(`${root}/`));
}

/** Enough glob for `exclude`: `*` within a segment, `**` across segments. */
export function matchesGlob(path, pattern) {
  const ANY_DEPTH = '';
  const ANY = '';
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, ANY_DEPTH)
    .replace(/\*\*/g, ANY)
    .replace(/\*/g, '[^/]*')
    .replace(new RegExp(ANY_DEPTH, 'g'), '(?:.*\\/)?')
    .replace(new RegExp(ANY, 'g'), '.*');
  return new RegExp(`^${escaped}$`).test(path);
}

/** What a changed path is, which decides whether it demands a node. */
export function classifyChange(path, { contractsDir = 'contracts', exclude = [] } = {}) {
  if (path === contractsDir || path.startsWith(`${contractsDir}/`)) return 'contract';
  if (TEST_FILE.test(path)) return 'test';
  if (exclude.some((pattern) => matchesGlob(path, pattern))) return 'excluded';
  if (INERT.has(kindOf(path))) return 'inert';
  return 'source';
}

/**
 * An exemption is a reason or it is nothing — the rule `[~]` already lives under.
 * Returns the reason, null when none was offered, and throws when one was offered
 * empty.
 */
export function exemptionFrom({ flag = null, messages = [] } = {}) {
  if (flag !== null && flag !== undefined) {
    const reason = String(flag).trim();
    if (!reason) throw new Error('--exempt needs a reason: an exemption nobody can read is a silent drop');
    return { reason, via: '--exempt' };
  }
  for (const message of messages) {
    const trailer = /^[ \t]*Keel-Exempt:[ \t]*(.*)$/mi.exec(message ?? '');
    if (!trailer) continue;
    const reason = trailer[1].trim();
    if (!reason) throw new Error('a Keel-Exempt: trailer needs a reason: an exemption nobody can read is a silent drop');
    return { reason, via: 'Keel-Exempt trailer' };
  }
  return null;
}

/** Non-zero exactly when a surface changed behaviour source and none of its nodes moved. */
export function undeclaredVerdict(surfaces) {
  return surfaces.some((surface) => surface.source.length > 0 && surface.moved === 0) ? 1 : 0;
}

function gitOut(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function undeclared(argv) {
  const config = loadConfig();
  const options = config?.undeclared ?? {};
  const contractsDir = config?.contracts ?? 'contracts';
  const surfaceList = config?.surfaces?.length ? config.surfaces : [{ name: 'repo', root: '.' }];

  const staged = argv.includes('--staged');
  const wantJson = argv.includes('--json');
  const base = argv.includes('--base')
    ? argv[argv.indexOf('--base') + 1]
    : (staged ? 'HEAD' : (options.base ?? 'origin/main'));
  const exemptFlag = argv.includes('--exempt') ? (argv[argv.indexOf('--exempt') + 1] ?? '') : null;

  if (gitOut(['rev-parse', '--git-dir'], { allowFail: true }) === null) {
    fail('git is not available here, so the diff cannot be read. A gate that cannot see the diff must never report green.');
  }
  if (gitOut(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { allowFail: true }) === null) {
    fail(`cannot resolve base ref '${base}'. Pass --base <ref>, or set undeclared.base in .keel/config.json.`);
  }

  let exemption = null;
  try {
    const messages = staged
      ? []
      : (gitOut(['log', `${base}..HEAD`, '--format=%B%x1e'], { allowFail: true }) ?? '').split('');
    exemption = exemptionFrom({ flag: exemptFlag, messages });
  } catch (error) {
    fail(error.message);
  }

  const changed = (staged
    ? gitOut(['diff', '--cached', '--name-only'])
    : gitOut(['diff', '--name-only', base])
  ).split('\n').map((line) => line.trim()).filter(Boolean);

  const exclude = options.exclude ?? [];
  const buckets = { source: [], test: [], inert: [], excluded: [], contract: [] };
  for (const path of changed) buckets[classifyChange(path, { contractsDir, exclude })].push(path);

  // Both sides of every contract file the diff could have touched, parsed as nodes.
  const atBase = [];
  const atHead = [];
  const contractFiles = new Set();
  for (const line of (gitOut(['ls-tree', '-r', '--name-only', base, '--', contractsDir], { allowFail: true }) ?? '')
    .split('\n').map((entry) => entry.trim()).filter(Boolean)) contractFiles.add(line);
  walk(join(ROOT, contractsDir), (file) => {
    if (file.endsWith('.md') && !file.endsWith('README.md')) contractFiles.add(relative(ROOT, file));
  });

  const frontmatterByFile = new Map();
  for (const file of contractFiles) {
    if (file.endsWith('README.md') || !file.endsWith('.md')) continue;
    const beforeText = gitOut(['show', `${base}:${file}`], { allowFail: true });
    const afterText = staged
      ? gitOut(['show', `:${file}`], { allowFail: true })
      : (existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : null);
    if (beforeText !== null) atBase.push(...parseContractText(beforeText, file).nodes);
    if (afterText !== null) {
      const parsed = parseContractText(afterText, file);
      atHead.push(...parsed.nodes);
      frontmatterByFile.set(file, parsed.frontmatter);
    }
  }

  const moved = movedNodes(atBase, atHead);
  const inRange = staged
    ? []
    : movedInPatch(gitOut(['log', '-p', '--format=', `${base}..HEAD`, '--', contractsDir], { allowFail: true }), { contractsDir });
  const movedAll = [...moved.added, ...moved.removed, ...moved.changed, ...inRange];

  const report = surfaceList.map((surface) => {
    const mine = (paths) => paths.filter((path) => attributeToSurface(path, surfaceList) === surface.name);
    const answered = movedAll.filter((node) =>
      contractCoversSurface(frontmatterByFile.get(node.file) ?? {}, surface));
    return {
      name: surface.name,
      root: surface.root,
      source: mine(buckets.source),
      tests: mine(buckets.test),
      inert: mine(buckets.inert),
      excluded: mine(buckets.excluded),
      moved: answered.length,
    };
  });

  // A file under no surface root is repo furniture — a lockfile, CI, a README. Surfaces
  // are where the repo has already said its code lives; a repo configuring none falls
  // back to one rooted at '.', so nothing stops being gated by accident.
  const ungated = buckets.source.filter((path) => attributeToSurface(path, surfaceList) === null);

  const failing = report.filter((surface) => surface.source.length > 0 && surface.moved === 0);
  const exitCode = exemption ? 0 : undeclaredVerdict(report);

  if (wantJson) {
    process.stdout.write(`${JSON.stringify({
      base: staged ? '(index)' : base,
      surfaces: report,
      ungated,
      moved: { added: moved.added.length, removed: moved.removed.length, changed: moved.changed.length, withinRange: inRange.length },
      exemption,
      verdict: exitCode === 0 ? 'pass' : 'fail',
    }, null, 2)}\n`);
    process.exitCode = exitCode;
    return;
  }

  process.stdout.write(`undeclared — behaviour that changed with no node to describe it  (against ${staged ? 'the index' : base})\n\n`);
  const withinRange = inRange.length && !moved.added.length && !moved.removed.length && !moved.changed.length
    ? '  (nothing moved between the endpoints, but a node moved within the range)\n' : '';
  process.stdout.write(`  nodes moved: ${moved.added.length} added, ${moved.removed.length} removed, ${moved.changed.length} status-changed\n${withinRange}\n`);

  for (const surface of report) {
    if (!surface.source.length && !surface.inert.length && !surface.excluded.length) {
      process.stdout.write(`  ${surface.name} (${surface.root}) — no behaviour source changed\n`);
      continue;
    }
    const undeclaredHere = surface.source.length > 0 && surface.moved === 0;
    process.stdout.write(`  ${surface.name} (${surface.root}) — ${undeclaredHere ? 'no contract node moved' : 'ok'}\n`);
    for (const path of surface.source) process.stdout.write(`      ${path}\n`);
    if (undeclaredHere && surface.tests.length) {
      process.stdout.write(`    ${surface.tests.length} test file(s) changed in the same diff — behaviour pinned by a test no node describes\n`);
    }
    for (const path of surface.inert) process.stdout.write(`    skipped as inert (${kindOf(path)}): ${path}\n`);
    for (const path of surface.excluded) process.stdout.write(`    skipped by undeclared.exclude: ${path}\n`);
  }

  for (const path of ungated) process.stdout.write(`  ungated — under no surface root: ${path}\n`);

  if (exemption) {
    process.stdout.write(`\n  EXEMPT via ${exemption.via}: ${exemption.reason}\n`);
    process.stdout.write('  The reason is the record. Nothing here judged whether it is a good one.\n');
  } else if (failing.length) {
    process.stdout.write(`\n  ${failing.length} surface(s) changed behaviour with no contract node moved.\n`);
    process.stdout.write('  Write the node first (/keel:change), or exempt it with a reason:\n');
    process.stdout.write('    keel undeclared --exempt "<why this change describes no behaviour>"\n');
  } else {
    process.stdout.write('\n  every surface that changed behaviour moved a node.\n');
  }

  process.exitCode = exitCode;
}

// ---------------------------------------------------------------- dispatch

// Only dispatch when invoked as a command. Importing this module — which the
// engine's own tests do — must not execute anything.
const invokedAsCommand = samePath(process.argv[1], ENGINE_PATH);

const [command, ...argv] = process.argv.slice(2);
if (invokedAsCommand) switch (command) {
  case 'probe': probe(); break;
  case 'contracts': contracts(argv); break;
  case 'untested': untested(argv); break;
  case 'undeclared': undeclared(argv); break;
  case 'model': model(); break;
  case 'unknowns': unknowns(argv); break;
  case 'mutation': mutation(argv); break;
  case 'mutate': mutate(argv); break;
  case 'ledger': ledger(argv); break;
  case 'version': version(argv); break;
  case 'doctor': doctor(); break;
  default:
    process.stdout.write(`keel — the deterministic half of the harness

  keel probe                  detect stack, package manager, surfaces, candidate commands
  keel contracts [--open]     inventory contract nodes by status (--json for machine output)
  keel contracts --lint       flag nodes too coarse for one test to prove
  keel untested [--json]      source files with no test file anywhere, by surface
  keel undeclared [--base <ref>] [--staged] [--json] [--exempt "<reason>"]
                              changed behaviour source that no contract node describes
  keel model                  check MENTAL_MODEL.md is present, complete, and short
  keel unknowns [--json]      every recorded UNKNOWN, with how long it has gone unanswered
  keel mutation [--json]      mutation score per surface, against the configured threshold
  keel mutate <file> --find <s> --replace <s> -- <cmd>
                              apply one transient mutation, run <cmd>, restore and verify
  keel ledger <phase> <note>  append a dated entry to .keel/ledger.md
                              [--domain <name>] [--nodes <n>] record structured fields
  keel ledger [--json]        read the ledger back
  keel version [--json]       this engine's version, and how the vendored copy compares
  keel doctor                 check the install is intact

Judgment belongs to the agent. This tool only counts, locates, and records.
`);
    process.exitCode = command ? 1 : 0;
}
