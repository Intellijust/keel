# Testing strategy

A test suite is not a pile of tests. It is a set of instruments, each answering a
different question at a different price, and most bad suites are bad because
someone answered a cheap question with an expensive instrument or an expensive
question with a cheap one.

This document is the doctrine. `/keel:bootstrap` writes a **project-specific**
strategy from it, because the tiers below have to be named in the project's own
vocabulary and wired to its own commands to be of any use.

## The assignment rule

Do not assign a test to a tier by asking "what am I testing?" Ask:

> **What could make this contract node false?**

The cheapest tier that can actually observe that cause is the right tier.

| If the node could be false because of… | it belongs in |
|---|---|
| a wrong branch, a bad calculation, a mishandled edge value | **Unit** |
| a query, a migration, a serializer, a transaction, DI wiring, a registered guard | **Integration** |
| a redirect, a cookie flag, a page transition, a real browser behaviour | **Journey** |
| the shape of a payload crossing between two codebases | **Boundary** |

This rule is worth more than any ratio. It replaces the pyramid, which tells you how
many tests to write but never which one to write now.

## The four tiers

### Unit — one module, collaborators substituted

Milliseconds each. The overwhelming majority of nodes belong here, because the
overwhelming majority of defects are logic defects.

Substitute at the boundary of the thing you own: the database, the clock, the
network, the filesystem, the random source. Do **not** substitute the module's own
internal helpers — that produces tests that pass while the composed behaviour is
broken, which is worse than no test.

If setting up a unit test requires more than a handful of substitutes, that is the
test telling you the module has too many collaborators. Listen to it.

### Integration — real adapters, in process

Seconds each. The module against a real database, a real HTTP layer, the real DI
container. This tier exists because the most expensive production defects are almost
never logic — they are a query that returns the wrong rows, a migration that did not
run, a guard that was never registered on the route, a serializer that drops a
field.

Use a real database, not an in-memory imitation of one. An imitation has different
semantics precisely where the bugs live: constraints, transactions, collation,
concurrency. If a container is too slow to start per run, start it once per suite.

Keep this tier small and deliberate. It is 10–100× the cost of a unit test and
earns its keep only on wiring you cannot otherwise observe.

### Journey — a real user path through the running system

Minutes each. A handful, chosen by what would be a crisis in production: signing in,
paying, submitting the thing the product exists to submit. One per critical path,
not one per feature.

Journey tests are the most likely to be flaky and the most expensive to maintain, so
each one has to be worth defending. If a node can be proven at a lower tier, prove
it there and leave the journey test to cover the *path*, not the logic along it.

### Boundary — agreement between codebases

Cheap, and usually forgotten. When a client and a server are developed separately,
the payload shape between them is a contract nobody tests until it breaks. Pin it:
shared types checked by the compiler, a schema validated in both directions, or
generated types from a single source.

In a monorepo with shared types this tier is often satisfied by the type-checker
alone — in which case say so explicitly in the project's strategy, so nobody
mistakes its absence for an oversight.

## What a good test asserts

Tier is half the decision. The other half is what the assertion pins.

**Assert observable behaviour, not the path taken to it.** `expect(response.status)
.toBe(403)` survives a refactor. `expect(guardSpy).toHaveBeenCalled()` does not, and
it passes even when the guard returns the wrong answer.

**Assertion theatre to refuse:**

- asserting a mock was called, when you could assert what the caller observed
- `expect(result).toBeTruthy()` — true of almost everything
- snapshotting whatever the code currently produces, which pins the bug along with
  the behaviour
- a test with no assertion at all, passing because nothing threw

**One behaviour per test.** A test that asserts six things reports one failure and
hides five. Name it after the contract node and it stays honest, because a node is
one behaviour by construction.

**Test names are the specification.** Someone reading the suite output should be
reading the contract back. `rejects an expired refresh token with 401` is a name.
`should work correctly` is a confession.

## Command tiers

A strategy that cannot be run at the right moment is not a strategy. Every project
needs these, whatever they are called locally:

| Command | Scope | Budget | When |
|---|---|---|---|
| **one** | a single file or test name | instant | the inner TDD loop |
| **changed** | only what this change affects | seconds | before every commit |
| **fast** | all unit tests | under a minute | constantly, and in hooks |
| **full** | every tier except journey | minutes | in CI on every PR |
| **journey** | the critical paths | minutes | pre-merge or on a schedule |

The budgets matter more than the names. A `fast` command that takes four minutes
will not be run, and a suite that is not run is documentation.

## Speed is a correctness feature

Slow suites are not merely annoying. They change behaviour: people stop running
them, agents skip them and report success from a partial run, and the feedback loop
that TDD depends on stops closing. Treat a slow tier as a defect with a cause —
usually a real dependency in the unit tier, or a container starting per test instead
of per suite.

## Flakiness is a defect, never a retry

A test that fails intermittently is making a true statement about a real race,
a shared fixture, or a time dependency — you just do not know which yet. Adding a
retry deletes the information. Quarantine it, mark the node `[!]` with the reason,
and fix the cause.

## Mutation testing — the check on the tests

Every tier above tells you whether the code works. None tells you whether the *tests*
work. A suite can execute every line, assert nothing, and stay green through any
change. Mutation testing is the only automated answer: change the code on purpose and
ask whether a test notices.

It is not a fifth tier. It is a meta-check that runs over the tiers you already have.

**A surviving mutant is a finding, not a metric.** Each one is exactly two things:

- **A missing test** — the mutant describes real behaviour nothing asserts. Write it.
- **An equivalent mutant** — unobservable at this tier: a log message, a string the
  tests stub past, a constant only an integration test could reach. Mark it with a
  reason. An un-reasoned suppression is score-gaming; a reasoned one is documentation.

### Two gates, because one number cannot work

A single global threshold fails for the same reason a coverage target fails: it
averages the code being written now with code nobody has tested in a year.

| Gate | Scope | Setting |
|---|---|---|
| **Commit / PR** | only the files this change touches | hard break at the target |
| **Full suite** | everything mutable | a **ratchet** — record the baseline, forbid regression |

Measure the baseline before choosing a target. If most mutants return `NoCoverage`,
the ceiling is `1 − noCoverage/total`, and no threshold above that is reachable today
however good the tests are. A gate nobody can pass gets disabled within a week, and
then there is no gate.

Never lower a threshold to make a commit pass. That is a decision about the project,
not about the change, and it belongs to the operator.

Setup specifics, including the pitfalls that cost real time, are in
`skills/bootstrap/profiles/mutation.md`.

## What not to measure

**Coverage percentage is not a goal.** It measures which lines executed, not which
behaviours are pinned; a suite can execute every line and assert nothing. Coverage is
useful in exactly one direction — as a list of files nothing has ever touched, which
is a starting point for `keel untested`, not a target to hit.

**A test count is not progress.** Ten tests of one behaviour is one behaviour.
Progress is nodes moved from `[ ]` to `[x]`, and that is what the contract counts.

**A mutation score is not a goal either** — it is a pointer at survivors. Chasing the
number produces tests written to kill mutants rather than to pin behaviour, which is
assertion theatre with extra steps.
