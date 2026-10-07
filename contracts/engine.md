---
domain: engine
surface: scripts
tests: scripts/**/*.test.mjs
---

# Engine

`scripts/keel.mjs` — the single-file, dependency-free engine behind every command
the skills run. Backfilled 2026-08-27 from reading the code: the repo had **zero
tests**, so nothing here starts `[x]`. Every node describes behaviour that already
exists; closing one means a test that has been seen to fail for the right reason
(mutation-witnessed, since these pass on their first run).

Ranked by what breaks if it is wrong: the contract parser and the exit codes come
first — every consuming repo's work queue rests on the former, and skills and CI
branch on the latter (mental model, invariant 3).

## Parsing a contract file

Closed 2026-08-27 by `scripts/keel.test.mjs`. RED witnessed by five mutations —
one (widening the marker regex) survived and turned out to be an equivalent
mutant: the regex and the `STATUS[marker]` lookup are redundant defences, and the
test was proven able to fail by breaking both at once.

`parseContract` has no schema behind it: whatever it accepts *is* the contract
format, in every consuming repo at once.

- [x] a `- [x]` line is a held node, `- [ ]` open, `- [~]` deferred, `- [!]` broken — and both `-` and `*` bullets are accepted
- [x] a line whose bracket carries any other character is not a node at all, rather than a node with a guessed status
- [x] a node's group is the nearest preceding `##`-or-deeper heading; a document-title `#` heading is never a group
- [x] two-space indentation nests: a node indented one level reports depth 1, and tabs count as two spaces
- [x] a `(deferred: reason)` or `(defer: reason)` annotation is captured as the node's reason, case-insensitively; `(broken: reason)` and `(regression: reason)` likewise
- [x] a deferred or broken node without such an annotation has a null reason — the fact `contracts --open` exists to catch
- [x] frontmatter between `---` fences yields key/value pairs; a file with no frontmatter yields none and still parses
- [x] node line numbers are 1-based and point at the node's own line, so `file:line` output is clickable

## The contracts command

- [ ] totals count each status across every non-README markdown file under the configured contracts directory
- [ ] the exit code is non-zero exactly when some deferred or broken node lacks a reason — an unexplained deferral is the one thing this command refuses to pass
- [ ] `--open` lists open **and broken** nodes as the work queue; deferred nodes are consciously parked and never appear in it
- [ ] a missing contracts directory fails with advice to run the install skill, not a stack trace
- [ ] `--json` emits the parsed files and totals for machine consumers

## Unknowns

- [ ] a `> UNKNOWN:` blockquote is one question through the end of its blockquote — a multi-line question is never split into several
- [ ] two UNKNOWN blocks in one blockquote are two questions
- [ ] a question is attributed to the nearest preceding heading, so it can be asked when a change touches that domain
- [ ] age comes from `git blame`, and an uncommitted question reports its age as unknown rather than zero — zero would start the staleness clock before the question exists in history
- [ ] the exit code is non-zero exactly when some question has gone unanswered longer than the configured age; fresh questions alone exit zero
- [ ] the scanned paths come from `unknowns.paths` in config, so a repo can exclude documentation that *demonstrates* the marker (this repo must: the doctrine's own example was reported as a real question until the install scoped the paths)

## Mutation scores

Scores are read off Stryker's JSON report on disk, never recalled from console
output — the whole point of the command.

- [ ] the full-suite score counts killed and timeout over killed+timeout+survived+noCoverage; ignored mutants are outside the denominator
- [ ] the covered-only score drops noCoverage from the denominator too
- [ ] a report with no mutants yields a null score rather than a crash or a 100
- [ ] the ceiling is reported — the best score reachable while noCoverage mutants remain
- [ ] the exit code is non-zero exactly when a surface falls below its recorded baseline by more than the tolerance — a ratchet, not a gate: scores below the target but at-or-above baseline pass
- [ ] a configured report file that does not exist is reported as "has Stryker been run?" per surface, and does not fail the ratchet
- [ ] no configured reports at all is a hard failure with advice, not an empty pass

## Mental model checks

- [ ] all seven required sections are matched case-insensitively by heading substring
- [ ] the line count over the soft limit is a FAIL, at it is not
- [ ] an `@MENTAL_MODEL.md` import is detected in CLAUDE.md or AGENTS.md; its absence is a FAIL, because a model nothing pulls into context steers nothing
- [ ] a missing model file exits non-zero with advice to run install
- [ ] the exit code is non-zero exactly when any problem was printed

## Ledger

- [ ] an entry needs a known phase (contract, plan, tdd, verify, review, note) and a non-empty note; an unknown phase, or a phase with no note, fails with the accepted list — *reworded 2026-08-27: this said "anything else fails", which bare `keel ledger` listing entries contradicts*
- [ ] the ledger file and `.keel/` directory are created on first write, seeded with the append-only header
- [ ] entries append — an existing ledger is never truncated or reordered

## Doctor

- [ ] a missing config, contracts directory, `test`/`lint` command, surface path, or mental model each surface as their own FAIL line
- [ ] stale unknowns fail doctor with a pointer at `keel unknowns`
- [ ] exit code is non-zero exactly when any FAIL was printed — CI's single wire to "is the install intact"

## Witnessing RED without losing work

`keel mutate <file> --find <literal> --replace <literal> -- <command>` applies one
transient mutation, runs a command against it, and restores the file. It exists
because the tdd skill's prose instruction to restore from a copy was read and still
violated twice in one session (mental model §2, §6): when something must *always*
happen, it belongs in the engine.

- [x] a `--find` string occurring exactly once is applied, the command run against the mutated file, and the file restored byte-for-byte before any verdict is printed
- [x] a `--find` string occurring more than once is refused **before anything is written**, naming the count — an ambiguous mutation silently tests something other than what was meant
- [x] a `--find` string that does not occur at all is refused the same way
- [x] the file is restored when the command fails, and when the command crashes
- [x] restoration is verified against the snapshot; a file that does not match afterwards is a hard error naming the snapshot path, never a silent partial restore
- [x] the snapshot is taken from the **working tree**, so uncommitted edits in the mutated file survive — the failure `git checkout <file>` caused twice on 2026-08-26
- [x] the snapshot is written outside the repository, so a `git clean` between mutation and restore cannot defeat it
- [x] the exit code carries the verdict: zero when the command failed (the mutant was killed — a test caught it), non-zero when the command passed (the mutant survived — behaviour nothing pins)
- [x] the verdict is printed in those words, so a passing command is never mistaken for a passing gate
- [x] a missing file, or a command that cannot be run, fails before the file is touched
- [x] no mutation is left behind by any path through the command — the property the whole command exists to guarantee

## Doctor: the harness holds itself to its own rules

- [x] a script named in `config.commands` that exists in the repo and has no test file covering it is reported by name — invariant 5, made mechanical rather than remembered
- [x] that report is a **warning, not a FAIL**: it does not change doctor's exit code, because an untested gate is a debt to schedule rather than a broken install
- [x] a command naming no in-repo script (`pnpm test`, `nx affected -t test`) reports nothing, rather than guessing at a filename
- [x] an unset `review.model` is reported with its consequence — review falls back to a self-pass, and an author reviewing their own work reads their intentions back into it
- [x] doctor reports when nothing in the repo invokes `undeclared` — a gate installed and never run is the failure it exists to prevent, one layer up
- [x] the warning names the places it looked, so a repo wiring the gate somewhere else can see the alarm is false
- [x] that report is a warning, never a FAIL, for the same reason the untested-tooling one is
- [x] a repo whose vendored engine predates the gate is not warned for failing to run it

## Linting the contract itself

Closed 2026-08-27. RED witnessed with `keel mutate`: dropping the identifier filter,
disabling the code-span check, disabling the word check, and removing the flag filter
from `scriptsNamedIn` were each killed. The flag filter's mutant **survived** first
time — no test covered a flag shaped like a path — and a test was added for it.

`contracts --lint` catches nodes that are not nodes: the gap-markers that look like
work queue entries but that no single test could ever prove.

- [x] a node carrying three or more inline-code spans is flagged as naming several functions rather than describing one behaviour
- [x] a node longer than the configured word limit is flagged as prose rather than behaviour
- [x] findings print with `file:line` so they are clickable, and quote the node
- [x] lint findings affect the exit code **only when `--lint` is passed**; without the flag the command's exit code is exactly as it was
- [x] a contract whose nodes are all well-formed prints that it found nothing, rather than printing nothing at all

## Ledger entries that can be read back

Closed 2026-08-27. RED witnessed with `keel mutate`: dropping the field-shape guard
(so a note opening with a parenthesis is eaten as fields), rendering empty fields,
and breaking the phase round-trip were each killed. Writing the tests caught a real
inconsistency first — the field prefix used one space where the rest of the line
uses two.

- [x] `--domain` and `--nodes` are recorded as structured fields and render as a bracketed prefix before the note
- [x] an entry written without those flags renders exactly as it does today — every existing ledger in every consuming repo stays valid (mental model §1: formats stay backward-compatible across 0.x)
- [x] entries written before this change parse: an unstructured note yields the same stamp, phase and note, with no fields
- [x] `keel ledger --json` emits every entry parsed into stamp, phase, fields and note
- [x] `keel ledger` with no arguments lists recent entries instead of failing

## Version, and the vendored copy that goes stale

A consuming repo holds a copy of this engine at `.keel/keel.mjs` so CI works from a
plain clone (mental model §2). Nothing versioned it until now, so no repo could tell
a stale copy from a current one, or from one somebody had edited by hand — the fork
the mental model warns about was undetectable. The engine now declares its own
version, and `doctor` compares it against whatever is vendored.

Every node here has to survive the copy being **older than this feature**: a 0.2.0
`.keel/keel.mjs` declares no version at all, and must read as unknown rather than
crash the command that is trying to help.

Closed 2026-08-31 by `scripts/version.test.mjs`. RED witnessed with `keel mutate`:
making the byte-equality check unreachable, sliding the behind/forked boundary,
comparing only the first version component, making `export` mandatory in the version
regex, reading an unversioned copy as current, dropping the no-vendored-copy guard,
dropping the absent-manifest guard, and promoting doctor's warning to a FAIL were
each killed by their own test. Eight mutations, none survived.

- [x] `keel version` prints the version this engine declares, and where it is running from
- [x] with a vendored copy present it also prints that copy's version and how the two compare
- [x] `keel version --json` emits the running version, the vendored version, and the comparison, for a CI step that wants to branch on it
- [x] the version is read out of a file's own source, tolerating either quote style and surrounding whitespace
- [x] versions order by numeric component rather than lexically, so 0.10.0 is after 0.2.0, and a missing component counts as zero
- [x] a file declaring no version at all reads as unknown rather than throwing — every vendored copy predating this feature is such a file
- [x] doctor reports a vendored copy older than the running engine, naming both versions and pointing at the re-vendor
- [x] doctor reports a vendored copy of unknown version as behind, since a copy predating versioning is by construction older
- [x] doctor reports a vendored copy declaring the *same* version whose bytes differ as edited by hand — one repo fixed and the engine silently forked
- [x] doctor reports a vendored copy *newer* than the running engine as a stale plugin rather than a stale repo — the operator updated the checkout and not the plugin they run skills from
- [x] a repo with no vendored copy at all is reported on not at all: vendoring is for CI, and a repo whose skills run the plugin copy is not misconfigured
- [x] doctor stays silent when the running engine *is* the vendored copy, which cannot know whether a newer plugin exists
- [x] `keel version` run *as* the vendored copy says so and names the command that can compare, rather than reporting itself current — a file compared against itself is not evidence, and this is the shortest command an operator in a consuming repo reaches for
- [x] every one of these is a **warning, never a FAIL**: a stale copy is debt to schedule, and doctor's exit code stays the API it was (invariant 3)
- [x] doctor reports a plugin manifest beside the running engine whose version disagrees with the engine's own — the release chore now spans two files, and a wrong number here makes every staleness report a lie

## Dispatching at all

Closed 2026-08-31. RED witnessed with `keel mutate`: degrading the symlink-aware
comparison back to a string compare was killed by the tests that run the engine from
a temp directory — which is how the bug was found, since macOS puts those behind a
symlink.

- [x] the engine runs its command when invoked through a **symlinked** path — `/var` against `/private/var` on macOS, or a symlinked checkout. Comparing `argv[1]` to the module URL without resolving symlinks made the engine exit 0 having printed nothing, which is the worst available failure for a tool whose exit code is an API (found 2026-08-31 while testing `keel version` from a consuming repo)

## A change no node describes

`untested` finds source with no test. This finds a **change** with no node — the
failure invariant 1 forbids and nothing until now could see.

Measured on the first consuming repo, 2026-10-02: of 151 pull requests that changed
non-test source after contracts landed, **103 changed no contract file at all**, and
**94 of those 103 added tests** — behaviour pinned by a test that no node describes.
One stream ran at 14% contract-touching across 76 such PRs and produced 35 of the 47
defects later traced to code written under the harness; a stream at 52% produced 10
from the same volume of code. The prose said "no code before contract" the whole time.

Closed 2026-10-02 by `scripts/undeclared.test.mjs`. Five of its tests were genuinely
RED first; the rest covered behaviour written ahead of them, so RED was witnessed with
`keel mutate` instead — fourteen mutations, all killed: the status comparison in
`movedNodes`, the test-file, inert and exclude branches of `classifyChange`,
longest-root-first ordering, contract-to-surface scoping, the empty-reason refusal,
the verdict condition, the unresolvable-base guard, the git-availability guard, the
intra-range patch scanner, `--staged` comparing against HEAD, the ungated report line,
and the tests-changed-alongside line. The engine was verified byte-identical
afterwards.

The gate is on the **diff**, not the repo — the same answer mutation testing got, for
the same reason: a gate nobody can pass is switched off inside a week. It reports and
exits non-zero; blocking stays CI's and the hook's job (mental model §7).

Two rulings the nodes below rest on, both decided 2026-10-02. **Inert files are
skipped but named**: `kindOf`'s suffix heuristics are a recorded sharp edge (mental
model §6), and a heuristic that excuses a file from a gate may never do so silently.
**A bug fix is not exempt**: a node marked `[x]` that did not hold was drift, so the
fix moves it through `[!]` to `[x]` and the gate passes on that movement. Exempting
bug fixes instead was rejected because nothing could then tell a fix from an
undeclared behaviour change — both read as source moved, contract still.

Two nodes below were corrected during TDD, 2026-10-02, when their tests failed and
the node rather than the code turned out to be wrong. **Files under no surface root
are not source**: the first wording attributed them to the repo, which made
`pnpm-lock.yaml`, a README and `.keel/config.json` into behaviour and would have
failed the gate on a lockfile bump. Surfaces are where a repo has already declared
its code lives, and a repo configuring none falls back to one surface rooted at `.`,
so nothing stops being gated by accident — the ungated files are listed either way.
**Movement is counted across the range, not between its endpoints**: marking a node
`[!]` and fixing it in the same branch nets to no change endpoint-to-endpoint, which
is exactly the bug-fix shape the ruling above blesses.

- [x] `undeclared` compares contract nodes at a base ref against the working tree, and reports every surface whose behaviour source changed while none of its own nodes did
- [x] a node counts as moved when it is added, removed, re-worded, or changes status — editing prose, a heading, or a comment inside a contract file satisfies nothing
- [x] a node that moved at any commit in the range counts, so marking a node `[!]` and fixing it in one branch is not read as no movement at all
- [x] a changed source file is attributed to the surface whose `root` contains it, longest root first
- [x] a file under no surface root is not behaviour source, and is reported as ungated so the omission stays visible
- [x] a contract file is attributed to a surface by its `surface` or `tests` frontmatter; one naming neither answers for every surface
- [x] a test file is never changed source — it is the evidence for a node, never the behaviour a node describes
- [x] a file whose kind is inert is not changed source, and every file skipped that way is named in the report
- [x] paths matching `undeclared.exclude` in config are not changed source, and are named the same way
- [x] an `exclude` pattern takes `*` within a path segment and `**` across segments
- [x] the exit code is non-zero exactly when some surface changed behaviour source and no node of its own moved
- [x] the report counts the test files that changed in the same diff and says so in those words when no node moved — that pairing is the measured failure, not an inference
- [x] a diff that flips a node from `[!]` to `[x]` passes, so a bug fix needs no exemption
- [x] `--exempt "<reason>"` passes, printing the reason in full
- [x] a `Keel-Exempt: <reason>` trailer on any commit in the range does the same, so the reason survives where a reviewer meets it
- [x] an exemption carrying no reason is refused, exactly as `[~]` with no reason is
- [x] `--base <ref>` diffs against that ref; with no flag it reads `undeclared.base`, then `origin/main`
- [x] `--staged` diffs the index, so a pre-commit hook can run before a commit message exists
- [x] a base ref git cannot resolve fails with advice naming it — a gate that cannot see the diff never reports green
- [x] git being unavailable fails the same way rather than exiting zero
- [x] `--json` emits each surface with its changed files, skipped files, moved nodes, exemption, and verdict

## What a file is, and what carries no behaviour

`kindOf` and the inert set were tuned on one NestJS/React repo and had no tests at
all until now, while deciding two things: what appears on `untested`'s backlog, and —
since 2026-10-02 — what `undeclared` lets through its gate without a node. Mental
model §6 named them a sharp edge; a public release (§1, answered 2026-10-02) turns
that from a private convenience into something strangers run on stacks this code has
never seen.

Closed 2026-10-02 by `scripts/untested.test.mjs`, 20 tests. One node was genuinely
RED — nothing stated the basename collision — and the other seventeen covered
behaviour that already existed, so RED was witnessed with `keel mutate`: sixteen
mutations, all killed, the engine verified byte-identical after. The ones worth
naming, because each would have passed silently before: reading the kind from the
whole path rather than the basename, ranking `.dto.` above `.service.`, loosening
`use[A-Z]` to `use`, treating `index` as a substring rather than a prefix, pairing a
test to its subject by path rather than basename, dropping `fixtures` from the
excluded segments, and counting comment lines as loc.

The property that makes an unfamiliar stack safe rather than silent: the **default
kind is `module`, which is not inert**. A Go or Rails repo matches none of these
suffixes, so everything reads as behaviour — a noisy backlog and an over-strict gate,
never a quiet miss.

- [x] a filename suffix decides a file's kind, matched on the basename, so a directory named `dto` does not make its contents dtos
- [x] the first matching suffix wins, so `user.service.dto.ts` is a service
- [x] a name beginning `use` and a capital letter is a hook, with or without a suffix
- [x] a `.tsx` or `.jsx` file carrying no other signal is a component
- [x] a file named `index.*` is a barrel
- [x] an unrecognised name is a module, which is a gated kind and never an inert one
- [x] dto, types, constants, barrel, wiring and schema are the inert kinds; every other kind carries behaviour
- [x] `undeclared` and `untested` read inertness from the same set, so the backlog and the gate cannot disagree

## Pairing a source file with its test

- [x] a source file is paired with a test by basename alone, anywhere in the repo, so a test living far from its subject still counts
- [x] two source files sharing a basename both read as tested when either one has a test
- [x] `untested` states that collision in its own output, so the limitation reaches the person reading the backlog
- [x] a `.d.ts` file is never source
- [x] a name carrying `.gen.` or `.generated.` is never source
- [x] a path segment of dist, migrations, test, tests, `__tests__`, `__mocks__`, e2e or fixtures puts a file outside source
- [x] only the js/ts family of extensions is scanned, so another language reports nothing rather than guessing

## The untested report

- [x] loc counts lines that are neither blank nor a `//` comment
- [x] files list longest first, capped at 40 per surface, and `--json` carries all of them
- [x] inert files are counted per surface rather than listed, so the number skipped is always visible

## Not yet contracted

- [ ] `probe` — stack detection, surface discovery, runner detection; report-only today, and its output shapes the install skill's proposals
- [ ] `findRoot` — walks up to the nearest `.keel/config.json` or `.git`, so the engine works from any subdirectory
