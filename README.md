# Keel

A development harness that steers coding agents toward high-quality software.

Behaviour is agreed as a written contract before code exists, built test-first from
the outside in, proven with real command output rather than claims, reconciled
against drift, and adversarially reviewed before it ships.

Keel is a Claude Code plugin. It installs into any project and does not care what
that project is written in.

## Why

An agent is fast, tireless, and eager to report success. Left alone it writes
plausible code, asserts the tests pass, and hands you something that compiles but
does not do what you asked. Prompting it to be careful does not fix this. Changing
what it has to pass through does.

## The arc

| | Skill | Question it answers |
|---|---|---|
| 1 | `/keel:change` | What should be true when this is done? |
| 2 | `/keel:plan` | How, in what order, and what could break? |
| 3 | `/keel:tdd` | Make it true, one node at a time |
| 4 | `/keel:verify` | Is it actually true, and is anything drifting? |
| 5 | `/keel:review` | What did we miss? |

Each skill triggers on natural speech, so the arc usually runs without anyone typing
a slash command: describing a feature enters CONTRACT, asking whether it works
enters VERIFY.

`/keel:ship` runs all five in one pass. Three more skills sit outside the arc, for
getting a project into it and keeping it there:

| Skill | What it does |
|---|---|
| `/keel:install` | Wires Keel into a project — surfaces, commands, the mental model, and the steering that holds without anyone remembering it. |
| `/keel:bootstrap` | Onboards an existing repo: a testing strategy in its own vocabulary, any missing test runners, contracts backfilled from the behaviour already there, and then the resulting test backlog. |
| `/keel:bootstrap --to-contracts` | The same, stopped once the behaviour is written down. No tests, no runners installed, no CI — a counted queue of `[ ]` nodes instead of a shared intention to test more. |
| `/keel:update` | Re-vendors a project's engine after the plugin moves on, and stops rather than flatten a local fix. |

**Why `--to-contracts` is worth having.** Charting a repo is cheap and reversible;
testing it is expensive and load-bearing. Splitting them settles the grain and
vocabulary of the contract over the whole repo before a single test is written to the
wrong shape, and turns "we should test more" into a number of open nodes ranked by
what breaks if they are wrong. The price is that a map is a promise of work, not
work: the repo is no safer afterwards, only honest about not being safe. The sitting
that follows is a resume, not a fresh bootstrap — prior stages are detected from what
is on disk rather than from a stored stage number.

**Why `/keel:update` exists.** A steered project runs a vendored copy of the engine
at `.keel/keel.mjs`, so CI works from a plain clone. That copy does not move on its
own and is not supposed to — but nothing used to notice when it had fallen behind, or
when somebody had edited it in place, which fixes one repo and silently forks the
engine everywhere else. Now `keel version` and `keel doctor` say so:

```
warn  vendored .keel/keel.mjs is 0.2.0; this engine is 0.3.0 — re-vendor it in
      its own commit (/keel:update)
```

A warning, never a failure — a stale copy is debt to schedule, not a broken install.
Updating is operator-invoked, never automatic, and lands in its own commit so "the
engine moved" is always its own reviewable line in history.

## Install

```
/plugin marketplace add https://github.com/Intellijust/keel.git
/plugin install keel@keel-harness
```

Working on Keel itself? Point the marketplace at your clone instead:
`/plugin marketplace add ~/path/to/keel`

Then, in the project you want steered:

```
/keel:install
```

That probes the stack, proposes surfaces and commands, writes `.keel/config.json`
and `contracts/`, and proves every command it configured by running it.

## What lands in a steered project

```
MENTAL_MODEL.md         what the code cannot tell you — imported by CLAUDE.md
contracts/<domain>.md   the behavioural contract — the source of truth for "done"
.keel/config.json       commands and surfaces, every command verified by running it
.keel/ledger.md         append-only record of which gates each change passed
.keel/keel.mjs          the vendored engine, so CI runs from a plain clone
.keel/plans/            what /keel:plan produced, kept beside the work it shaped
```

`MENTAL_MODEL.md` holds purpose, vocabulary, invariants, the reasons behind
load-bearing decisions, and where the sharp edges are — governed by one rule: it holds
only what you cannot recover by reading the code. `CLAUDE.md` imports it, so it is in
context on every change without anyone remembering it.

Contract nodes use four markers: `[x]` holds and is tested, `[ ]` agreed but not
built, `[~]` deferred with a reason, `[!]` known broken with a reason. Reasons are
mandatory on the last two — silently dropping a requirement is how agent work looks
finished while being partial.

## The engine

`scripts/keel.mjs` — no dependencies, Node 18+. It does only the parts that must not
be misremembered:

```
keel probe                  detect stack, package manager, surfaces, candidate commands
keel contracts [--open]     inventory contract nodes by status
keel untested [--json]      source files with no test file anywhere, by surface
keel undeclared             changed behaviour source that no contract node describes
                            [--base <ref>] [--staged] [--json] [--exempt "<reason>"]
keel model                  check MENTAL_MODEL.md is present, complete, and short
keel unknowns [--json]      every open question, with how long it has gone unanswered
keel mutation [--json]      mutation score per surface, read from Stryker's report
keel mutate <file> …        apply one transient mutation, run a command, restore and verify
keel ledger <phase> <note>  append a dated entry
keel version [--json]       this engine's version, and how the vendored copy compares
keel doctor                 check the install is intact
```

Judgment stays with the agent. Counting, locating, and recording do not.

## Reading

- [`docs/DOCTRINE.md`](docs/DOCTRINE.md) — the five phases, the nine invariants, the
  five axes of drift. Every skill points here.
- [`docs/MENTAL-MODEL.md`](docs/MENTAL-MODEL.md) — the seven sections, the boundary
  rule that keeps the file from becoming a second README, and why each section earns
  its place.
- [`docs/TESTING-STRATEGY.md`](docs/TESTING-STRATEGY.md) — the four tiers, the rule
  for assigning a test to one, what a good assertion pins, and how the mutation gate is
  split between changed files and a full-suite ratchet. `/keel:bootstrap` writes each
  project its own version of this.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — why each part is the way it is, including
  the two features that were argued against first and then added, and what is
  deliberately left out.
