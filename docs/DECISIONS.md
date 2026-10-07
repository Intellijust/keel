# Design decisions

Keel was modelled on an earlier internal harness, reimplemented from its published
skill manifest rather than its source. That manifest supplied the workflow and the
essence; every mechanism here is new.

This file records **why** each part is the way it is — including the decisions that
were argued against first and then overridden, since a decision without its reasoning
is one somebody will helpfully undo.

## The load-bearing ideas

**A written behavioural contract that precedes code.** A human-readable hierarchy of
expected behaviour, versioned in the repo, written before implementation, and the
thing tests are derived from. Everything else in the harness is scaffolding around
this one idea.

**Phase gates with explicit transitions.** `change → plan → tdd → verify → review`
prevents the single most common agentic failure: sliding from "I think I understand"
straight to "I have written it".

**Feedback loops installed as mechanism, not remembered as instruction.** The point of
the setup skills is to put deterministic signal in front of the agent. Prompting an
agent to be careful does not work; making the environment tell it the truth does.

**Drift as a first-class concept.** Intention, contract, tests, code, docs, and the
mental model can all diverge. Five of the six axes are invisible to a passing test
suite, which is exactly why they need a ritual rather than good intentions.

**Independent adversarial review.** An author cannot review their own work — they read
their intentions back into the code and see the version they meant to write.

**Skill descriptions are routing signals, not documentation.** The frontmatter
`description` is the string the agent matches against, which is why each one carries
an explicit trigger clause written for natural speech rather than a summary.

## Decisions, with reasons

**Nine skills, not twenty.** The obvious structure is one skill per setup task — one
for the test runner, one for linting, one for architecture boundaries, one per
framework variant. That is a lot of routing surface for a small number of distinct
behaviours, and overlapping trigger clauses make dispatch *less* reliable, not more.
Keel has one `install` skill carrying the probe→propose→install→prove doctrine, with
stack specifics demoted to `profiles/` reference files, and one `ship` skill where
autonomy is a flag rather than a second arc.

Onboarding an existing repo and giving it a test strategy are the same job — you
cannot decide what tier a backfilled test belongs in without a strategy — so they are
one `bootstrap` skill. It delegates the actual test-writing to `/keel:tdd` rather than
reimplementing it, because `tdd` already carries the technique backfilling
specifically needs: those nodes describe behaviour that already exists, so their tests
pass on the first run and prove nothing until a deliberate mutation says otherwise.

**Stopping at contracts is a flag, not a ninth skill.** *Argued 2026-08-30, decided
2026-08-31.* Backfilling a repo's behaviour into contracts without writing any tests
is a real and frequently wanted job — cheap, reversible, and worth doing on its own,
because it settles the grain and vocabulary of the contract over the whole repo
before a single test is written to the wrong shape. The question was only whether it
is its own skill.

The case for a skill was routing: the trigger surface is the description string, and
a mode buried inside `bootstrap` has no trigger clause of its own, so an operator
saying "write down what this repo does, do not write tests" has to land on
`bootstrap` first and the agent then has to remember a flag. A ninth skill was built
on that argument and then removed, because the argument is answerable and the cost is
not: the flag's phrasings go straight into `bootstrap`'s own description, which
costs one clause, while a second skill duplicates four stages of prose that then have
to be kept in step with the original forever. Duplicated prose does not drift
loudly — it drifts silently, and the copy that is wrong is the one nobody re-reads.

What settled it is that `--to-contracts` is a **stop condition**, not a different
job. It removes stages 5, 5b and 6 and changes nothing about the four that remain,
which is the same shape as `ship --auto` removing confirmations without removing a
gate. The one thing it genuinely changes is who validates an `[x]`: in a full run
stage 5 puts every claim under a suite eventually, and with the flag nothing does —
so the flag carries an explicit rule that the surface's existing suite is run once
and seen green, or nothing on that surface is marked held.

**Re-vendoring is a skill, and staleness is the engine's.** *Added 2026-08-31.* A
consuming repo runs a vendored copy of the engine at `.keel/keel.mjs`, and until now
nothing versioned it: a repo could not tell a stale copy from a current one, or from
one somebody had edited by hand — which is the fork the mental model warns about,
undetectable. The split follows the skill-versus-engine rule. **Detecting** staleness
must always happen, so it is mechanism: the engine declares `KEEL_VERSION`, `keel
version` prints it against whatever is vendored, and `doctor` warns. **Acting** on it
is judgment — is that difference a stale copy or somebody's local fix, is the plugin
itself current, did CI pass under the new engine — so it is prose, in `/keel:update`.

The line that decides it is that nothing in Keel writes an engine. A `keel update`
command would be an engine that overwrites an engine, which is one accident away from
the self-update the mental model rules out, and would put the irreversible step
(flattening a local fix) behind a command with no conversation in front of it. The
skill instead stops on a fork and sends the fix upstream, where it belongs.

Three consequences worth naming. Byte equality is checked **before** versions, which
is the only way `forked` — same version, different bytes — is detectable at all, and
it also keeps a vendored engine silent about its own staleness, since it cannot know
whether a newer plugin exists. A copy declaring **no** version reads as behind rather
than as an error, because every copy predating this feature is such a file. And every
verdict is a **warning**, never a FAIL: a stale copy is debt to schedule, and
`doctor`'s exit code is an API that CI already branches on (invariant 3).

The cost is a release chore spanning two files — `plugin.json` and the engine's own
constant. `doctor` warns when they disagree, because a wrong number there makes every
staleness report a lie.

**The undeclared gate is an engine command, not a hook recipe.** *Added 2026-10-02.*
Invariant 1 — no code before contract — was prose for the harness's whole life, and
prose is what habit beats. Measured on the first consuming repo: of 151 pull requests
that changed non-test source after contracts landed, 103 touched no contract file at
all, and 94 of those added tests. The stream running at 14% contract-touching produced
35 of the 47 defects traced to code written under the harness; the stream at 52%
produced 10 from the same volume of code.

Three things decide its shape. It compares **parsed nodes**, not changed files,
because "a file under `contracts/` changed" is satisfied by a whitespace edit — the
gate would fail open on exactly the diligent-looking pull request it exists to catch.
It is scoped to the **diff**, which is the answer mutation testing already arrived at
for the same reason: a gate nobody can pass is switched off inside a week. And it is
scoped **per surface**, which is not decoration — three of the pull requests it fails
did touch a contract file, each moving nodes in `api.md` while changing web source
with no web node, and a file-level check passes all three.

A bug fix is not exempt. A node marked `[x]` that did not hold was drift, so the fix
moves it through `[!]` to `[x]`. Exempting bug fixes was considered and rejected:
nothing could then tell a fix from an undeclared behaviour change, since both read as
source moved and contract still. The escape hatch is a reason — `--exempt` or a
`Keel-Exempt:` commit trailer — and an empty one is refused, the rule `[~]` already
lives under.

The engine only reports and exits non-zero; blocking stays CI's and the hook's job in
the consuming repo (mental model §7), which is why `install` offers the wiring and
`verify` runs the command.

**Per-domain contract files, not one file.** A single contract file does not survive a
monorepo: every change touches it, every agent reads all of it, and merge conflicts
are constant. One file per surface under `contracts/`, each declaring in frontmatter
where its tests live — which also gives drift detection a scope to search instead of
the whole repo.

**Four status markers instead of prose.** `[x]` held, `[ ]` open, `[~]` deferred,
`[!]` broken, with a mandatory reason on the last two. Silently dropping a requirement
is how agent work appears complete while being partial, and a marker makes the drop
impossible to hide.

**Verify splits mechanism from judgment.** Reasoning about alignment is judgment.
Whether the code *runs* is not — and letting that become a judgment call is exactly
how "tests pass" gets asserted without a test ever running. So `verify` executes the
project's real lint, test, and build and quotes the actual output *before* it reasons
about anything.

**A ledger.** An arc that lives only in conversation leaves "which gates did this
change actually pass?" unanswerable a week later. One appended line per phase in
`.keel/ledger.md`. Cheap, and it makes the harness auditable.

**Review works with no API keys.** Independence comes from *withholding context* —
the reviewer never sees the authoring reasoning — which is free. A different model
improves it and is used when one is configured, but it is not the mechanism. The
default is a blind subagent with a refutation brief.

**RED must be witnessed, and for the right reason.** Implied by TDD everywhere, stated
as an explicit invariant here, because the specific way agents break TDD is writing a
test that fails on a typo or a missing import, fixing the implementation, and counting
the resulting green as proof.

## Overridden objections

Two features were left out on stated grounds and later added. Both objections turned
out to be right about something narrower than what they were used to reject.

**Mental model — excluded, then restored with a boundary rule.** The objection: most
projects already spread conceptual material across README, `CLAUDE.md`, and ADRs, so a
third home invites contradiction. That was true and addressable rather than fatal.

What answers it is a single rule: **the mental model holds only what you cannot recover
by reading the code.** Anything derivable from source belongs in the source; anything
about what *should* be true belongs in `contracts/`; anything procedural belongs in
`CLAUDE.md`. What survives is unrecoverable knowledge — purpose, vocabulary,
invariants, the reasons behind load-bearing decisions, and where the sharp edges are —
which has no other home, and is exactly what an agent reconstructs plausibly and
wrongly.

Two further guards keep it from becoming a second README. The conventions file
**imports** it (`@MENTAL_MODEL.md`) rather than restating it, so there is one copy and
it is in context on every change. And it carries a ~200-line soft limit enforced by
`keel model`, because length is the reliable symptom of the boundary rule slipping.

It is swept as drift axis 6 during `verify` — when a change touches something it
describes — rather than being enforced by a hook after every turn.

**Mutation testing — excluded as a phase, restored as two gates.** The objections: a
whole-suite run is too slow to sit inside a change loop, and a percentage threshold is
the coverage mistake again, an aggregate that can be met while the behaviour you care
about goes unguarded.

Both turned out to be arguments about *scope*, not about mutation testing. What answers
them is running it over **the diff** rather than the codebase, and splitting the
threshold in two: a hard break on changed files, where test-first work genuinely scores
high, and a **ratchet** on the full suite, which forbids regression instead of demanding
a number that is not yet reachable.

Measuring before choosing is what makes that honest. On the first real repo, 3,190 of
5,725 mutants came back `NoCoverage`, capping the full-suite score at 44% — so a 70%
gate on everything would have failed every commit forever and been switched off inside
a week. The same 70% on changed files is comfortably passable: files written
contract-first scored 92% and 100%.

The hand-applied technique stays for surfaces with no mutation runner, and as the way
to witness RED when a test passes on its first run.

## Deliberately not included

**Architecture linting.** Executable layer-boundary rules with green-on-day-one
baselines are genuinely valuable, and they belong in a project's own lint config and
CI — not in a harness that has to install itself into arbitrary codebases. Candidate
for a later phase, as a profile rather than a skill.

**A README drift hook.** A narrow case of drift axis 5, already covered by `verify`.

**Presentation tooling** — rendering a diff as an image, splitting long responses.
Useful, but not part of the quality mechanism.
