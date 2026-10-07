---
name: bootstrap
description: "Onboard an existing repository into Keel: reconcile its mental model, write a testing strategy, install any missing test runners, backfill contracts from the behaviour that already exists, and work through the resulting test backlog. Triggers when the operator asks to bootstrap, backfill, onboard, or retrofit an existing project or repo, asks to add tests to an untested codebase, asks for a testing strategy, or asks to set up a test runner where there is none. Pass --to-contracts to stop after the contracts are written and skip the test backlog, the mutation gate and CI — also the right route when the operator asks to backfill, seed or map contracts without writing any tests."
---

# BOOTSTRAP — onboard an existing repository

Read `${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` and
`${CLAUDE_PLUGIN_ROOT}/docs/TESTING-STRATEGY.md` before starting. This skill leans on
both continuously.

`/keel:install` makes the harness work. **This** makes the repo covered. It is the
largest thing Keel does, and the only one that cannot be finished in a single
session on a real codebase.

## The shape of this work

Six stages. Stages 1–4 are one sitting. Stage 5 is a backlog you return to.

1. **Inventory** — measure the gap, deterministically, and reconcile the mental model.
2. **Strategy** — decide the tiers and commands, in the project's own vocabulary.
3. **Runners** — install what is missing, prove it with one real test.
4. **Contracts** — write down the behaviour that already exists.
5. **Backlog** — work the queue, domain by domain, through `/keel:tdd`.
6. **Enforce** — wire CI so the new floor cannot be lowered.

### `--to-contracts`

Stop after stage 4. Stages 1–4 run unchanged; stages 5, 5b and 6 do not run at all.
The operator gets a testing strategy, whatever runners they approved, and a contract
that says what the repo already does — and not one new test.

The flag exists because charting is cheap and reversible while testing is expensive
and load-bearing, and because the **grain and vocabulary of the contract are worth
settling over the whole repo before a single test is written to the wrong shape**.
What it buys is a countable gap: `[ ]` nodes ranked by what breaks if they are wrong,
instead of a shared intention to test more.

Two things change inside the stages it does run:

- **Stage 3 installs nothing unless the operator asks for it.** A runner exists to
  run tests, and this pass writes none. Propose it, price it, and let them defer —
  then record which surfaces have no runner, because that decides how much of their
  contract can ever be `[x]` (see below).
- **`[x]` needs the suite seen green in this pass.** In a full run, stage 5 puts every
  claim under a suite eventually. Here nothing does, so the marker is only as honest
  as stage 4 makes it. Run the surface's existing test command once — that is
  reading, not writing — and keep the output. If the suite is red, the nodes its
  failures cover are `[!]` with the failure as the reason. If the suite cannot be run
  at all, **nothing on that surface is `[x]`**: write the behaviour `[ ]` and lead the
  report with the fact that the surface is unverifiable. Inferring `[x]` from a spec
  file existing nearby is the exact lie this harness exists to prevent, and with this
  flag it is one keystroke away.

The sitting that follows one of these runs is a **resume**, not a fresh bootstrap —
see below, and read the ledger before you plan anything.

Everything else — the pruning, the ranking, the depth-over-breadth rule below, the
first-domain check-in — applies exactly as written. The flag removes work, never a
check. Hold the depth rule harder here, in fact: the discipline that normally punishes
a shallow node is being made to write its test, and that step is the one this flag
removes. Nothing downstream will catch you.

**Read this before you start stage 4:** the single failure mode of this skill is an
agent generating hundreds of shallow contract nodes and hundreds of vacuous tests,
producing a repo that looks covered and is not. That outcome is worse than no
bootstrap at all, because it destroys the signal the contract is supposed to carry.
Depth over breadth, every time. A domain properly done and nine domains left `[ ]`
is a success. Ten domains skimmed is a failure.

## Stage 1 — Inventory

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" probe
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" untested
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger
```

If `probe` reports Keel is not installed, run `/keel:install` first — this skill
assumes surfaces and commands already exist.

### Resuming a partial bootstrap

This skill does not finish in one sitting, and `--to-contracts` makes a second
sitting the plan rather than the exception. **Nothing records which stages ran.**
That is deliberate — a stored stage number lies the moment somebody edits the files
by hand — so read the evidence instead, before you plan anything:

- **`keel ledger`** is the strongest signal. A `CONTRACT` entry naming bootstrap
  means stage 4 ran, and a `--to-contracts` run says so in its own words; `TDD`
  entries per domain mean stage 5 was under way.
- **`keel contracts`** confirms it against the files: a domain with nodes has been
  contracted, and its held-versus-open split is how far stage 5 got.
- **`docs/TESTING-STRATEGY.md`** existing means stage 2 ran. The runners it names,
  and whether they are actually installed, tell you about stage 3.

Where an artifact exists, **do not run the stage that produces it — reconcile it**:

- **Stage 2** — read the strategy that is there and propose amendments as a diff.
  The operator already agreed that document, and their agreement is the asset; a
  rewrite quietly discards it.
- **Stage 3 is the exception, and the one a resume usually owes in full.** A
  `--to-contracts` sitting installed nothing *on purpose* — a runner exists to run
  tests, and that sitting wrote none. So a strategy document naming runners that do
  not exist is the expected state after a flagged run, not a stage that failed. Run
  stage 3 properly now; stage 5 cannot start without it.
- **Stage 4** — a domain that has nodes is done. Add domains it never covered, and
  add nodes for behaviour genuinely missing, saying which are new. **Never reword an
  existing node** because you would have phrased it differently: churn breaks the
  `[x]` history and the mapping between nodes and the tests that prove them, and it
  buys nothing.
- **Held nodes from an earlier sitting are a claim, not a quotation.** `[x]` was
  written against a suite as it stood that day. Run the surface's suite once before
  you trust it and before you build on it — a node marked held in a session that
  ended weeks ago is exactly the green this harness refuses to take on faith
  (invariant 3). Anything that no longer passes is `[!]` with the failure as the
  reason, and that is a finding for the operator, not a repair to slip in silently.
- **Ranking** still applies, to what is left rather than to the whole repo.

Contracts written by `/keel:change` during ordinary work count exactly the same.
They were not produced by this skill, and they are no less real for it.

**Where the remaining work starts.** After reconciling: stage 3 for any surface still
without a runner, then stage 5 for the open queue, then 5b and 6. If the earlier
sitting was `--to-contracts`, that is the whole of what is left — stages 1, 2 and 4
are behind you, and stage 3 is waiting.

Then say plainly, before you touch anything: which stages you believe already ran, the
evidence for that, and what you intend to run now. Getting this wrong silently is
expensive; getting it wrong out loud costs one sentence.

`untested` is a starting point, not a work list. Prune it by judgment before it
becomes one:

- **Vendored or generated code** — `components/ui` primitives from a component
  library, generated clients, scaffolded route trees. Not yours; do not test them.
  Exclude them explicitly and say you did.
- **Trivial pass-throughs** — a controller method that calls one service method and
  returns it, with no branching, no mapping, no guard of its own. Covered better by
  one integration test of the route than by a unit test of the delegation.
- **Everything else** is a candidate.

### Reconcile the mental model

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" model
```

An existing repo usually has a mental model already — scattered across the README,
`CLAUDE.md`, ADRs, long explanatory comments, and the heads of whoever wrote it. Your
job is to **reconcile**, not to invent: gather what is written down, find where the
sources contradict each other, and bring the result into one file under the boundary
rule in `${CLAUDE_PLUGIN_ROOT}/docs/MENTAL-MODEL.md`.

Where two existing documents disagree about the same thing, that is a finding —
report it rather than silently picking the newer one.

On a repo with real history, mine the git log for **section 5 (decisions)**: a revert,
a re-revert, or a commit message arguing for an approach is a decision with its reason
attached. This is the cheapest source of that section you will ever get.

Do this **before** ranking the backlog, because the model's invariants decide the
ranking — see below.

### Rank the remainder

Rank what remains by **what breaks if it is wrong**, not by line count. The mental
model's invariants come first by construction: an invariant with nothing enforcing it
is the highest-value test in the repo.

1. **Money, identity, and access** — auth, permissions, tenancy, payment, anything
   that could expose one user's data to another. Always first, regardless of size.
2. **Data integrity** — writes, migrations, cascades, anything that could corrupt or
   lose state a user cannot recreate.
3. **Business rules with real branching** — eligibility, pricing, scheduling,
   validation. The logic the product exists to get right.
4. **User-visible flows** — the paths people actually take.
5. **Everything else.**

Report the inventory with that ranking and the pruning you applied. Numbers first:
how many files, how many lines, what fraction of each surface.

## Stage 2 — Strategy

Write `docs/TESTING-STRATEGY.md` **in the target repo** — a real document for the
humans on this project, not a copy of the doctrine. Derive it from
`${CLAUDE_PLUGIN_ROOT}/docs/TESTING-STRATEGY.md` and make every part concrete:

- **The tiers, in this project's names.** Which runner, which file pattern, which
  directory. If the project has no integration tier, say so and say what that leaves
  unproven — do not quietly plan four tiers into a repo that will maintain two.
- **The assignment rule**, restated with two or three examples drawn from *this*
  codebase. Real file names. This is the part people will actually use.
- **The command tiers** — one, changed, fast, full, journey — as commands that run
  here, with the measured time of each beside it. Measure them; do not estimate.
- **What is deliberately not tested**, and why. Vendored code, generated code,
  trivial delegation. Written down, so its absence reads as a decision rather than
  an oversight.

Get the operator's agreement on this document before stage 3. It determines every
test that follows, and it is much cheaper to argue about now.

## Stage 3 — Runners

For each surface with no runner, or a runner that cannot express a tier the strategy
needs:

Read `${CLAUDE_PLUGIN_ROOT}/skills/bootstrap/profiles/runners.md` for the choice.
**Propose, do not install.** A test runner is a long-lived dependency and the
operator owns that decision. Give them the choice, the reason, and the cost.

Once approved, in this order:

1. Install the dependencies and write the config. Match the project's existing
   conventions — the same package manager, the same TypeScript settings, the same
   path aliases. A test runner that resolves imports differently from the build is a
   source of failures that teach nothing.
2. **Write exactly one real test** — not a `expect(true).toBe(true)` smoke test. Pick
   the smallest genuine behaviour on that surface and prove it. Then break the
   implementation and confirm the test catches it. A runner that has never
   observed a real failure is not known to work.
3. Add the command to `.keel/config.json` and to the strategy document.
4. Show the operator the command and its real output.

Do not proceed to stage 4 for a surface whose runner is not proven.

## Stage 4 — Contracts

Now write down what already exists, one domain at a time, highest-ranked first.

**Two sources, and they disagree — which is the point.**

*From existing tests.* A passing test is proven behaviour: write it as `[x]`. This is
the cheapest contract material available, and it turns the suite into a readable
specification. Read the test body, not just its name — a test named
`handles errors` may assert something quite specific, and a test named precisely may
assert nothing at all. If a test's assertion does not support its name, the node
describes what it **actually** proves, and you note the discrepancy.

*From reading the code.* Behaviour with no test is `[ ]` — your backlog. Read for
branches, guards, error paths, and edge handling. Every `if`, every `catch`, every
early return is a behaviour somebody intended.

**Where they disagree, you have found something.** Code with no test is a gap. A test
asserting behaviour the code no longer has is a lie. A branch that cannot be reached
is dead code. Report all three; do not silently resolve them.

Write behaviour, never structure (invariant 5). Nodes that name classes and methods
are the characteristic failure of automated backfill, and they are worse than nothing
— they cement the current design as if it were the requirement.

When behaviour is genuinely unclear from code and tests together, **do not guess**.
Write it as `[ ]` with a question, or leave the section out and say so. An invented
node is a false requirement that will be defended by future tests.

Stop and check in after the first domain. Show the operator the nodes and ask whether
the grain and vocabulary are right. Getting this wrong across thirty domains is the
expensive mistake available here.

**With `--to-contracts`, this is the end of the run.** Record it and hand over:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts --lint
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts --open
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger contract \
  --domain "<domains>" --nodes <N> \
  "bootstrap --to-contracts: N nodes across D domains (H held, O open); suite <green|red|unrunnable>; runners <installed|proposed|none>; no tests written"
```

Report as below, and say plainly that **no test was written and the repo is no safer
than it was this morning — only honest about not being safe.** Then name the next
step and let them choose it: `/keel:tdd` to work the queue a domain at a time, or
this skill again without the flag for stages 5, 5b and 6. Do not start either in the
same pass.

## Stage 5 — Backlog

*Skipped entirely under `--to-contracts`.* The queue is the deliverable there, not the
starting point.

The queue is now explicit:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts --open
```

Work it through **`/keel:tdd`**, in ranked order, one domain per pass. Do not write
these tests by a different route — `tdd` already carries the part that matters here:
these nodes describe behaviour that already exists, so their tests will pass on the
first run, and the only way to know a test is real is to break the implementation and
watch it fail. That section of `tdd` exists for exactly this situation.

Per domain: run the tier the strategy assigns, witness RED by mutation, mark nodes
`[x]`, run the surface's full suite, and record it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger tdd "<domain>: N nodes green, mutations killed"
```

Between domains, report progress as **nodes moved**, never as tests written. Ten
tests of one behaviour is one behaviour.

Expect to stop mid-backlog. That is the normal outcome, and the contract is the
handoff: `[ ]` nodes are the remaining work, and any session can pick them up. Tell
the operator plainly where you stopped and what is left.

## Stage 5b — Mutation gate

Once a surface has a runner and real tests, mutation testing is what proves those tests
assert anything. Read
`${CLAUDE_PLUGIN_ROOT}/skills/bootstrap/profiles/mutation.md` — it carries the setup
pitfalls, which are numerous and cost real time.

**Measure the full-suite baseline before proposing any threshold.** If most mutants come
back `NoCoverage`, the ceiling is `1 − noCoverage/total`, and a threshold above it is
unreachable today no matter how good the tests are. Propose the two-gate arrangement:
a hard break on changed files, a ratchet on the full suite. A gate nobody can pass gets
disabled within a week, and then there is no gate.

Prove it the same way as a runner: run it, then confirm it **fails** on a file whose
tests you have deliberately weakened.

## Stage 6 — Enforce

A bootstrap that does not change CI decays. Before declaring this done:

- The `full` command runs on every pull request.
- The **mutation gate** runs on every pull request, scoped to the diff, and is a
  required check. A commit hook is worth having too, but it is bypassable and so is a
  convenience rather than a gate.
- New surfaces' runners are in CI, not only on your machine.
- The `changed` command is fast enough for a pre-commit or Stop hook — measure it and
  propose it only if it is.
- If the project wants a floor, make it a **ratchet on `[ ]` nodes in touched
  domains**, not a coverage percentage. Coverage measures execution; the contract
  measures agreement.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger note "bootstrap: N domains contracted, M nodes held, K open; runners: <list>; CI enforcing <commands>"
```

## Reporting

Never report bootstrap progress as a percentage of the repo. Report:

- **Domains contracted**, and how many are left untouched.
- **Nodes held / open / deferred / broken**, from `keel contracts`.
- **What the backfill found** — untested behaviour, tests that assert less than their
  name claims, dead branches, behaviour nobody could explain.
- **What you deliberately excluded**, and why.
- **Where you stopped.**

Under `--to-contracts`, add **that no tests were written** — first, if anything in the
operator's phrasing suggested they expected some.
