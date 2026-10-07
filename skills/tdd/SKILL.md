---
name: tdd
description: "Implement contract nodes outside-in through witnessed RED-GREEN-REFACTOR. Triggers when implementing behaviour, writing code, writing tests, fixing a failing test, making a test pass, or closing an open node from the contracts. Also runs as the third phase of the Keel arc after /keel:change or /keel:plan."
---

# TDD — make it true, one node at a time

Read `${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` if you have not this session.

The loop below is not a suggestion about style. It is the only mechanism that
distinguishes code that works from code that looks like it works.

## Before you touch anything

Check `MENTAL_MODEL.md`'s **sharp edges** for the files you are about to change. Each
entry names what to read first; read it. That section exists because nothing in code
marks itself as dangerous.

Check its **invariants** too. A change that breaks one is a stop-and-escalate, not a
test to adjust.

## Entry check

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts --open
```

If there is no open node covering what you are about to build, **stop and run
`/keel:change` first**. Building without a contract node is the failure this
harness exists to prevent — you would be inventing the requirement and grading your
own work against it.

If the operator has handed you a bug report rather than a node, the node is
`[!] <the behaviour that should hold>`; write it, then continue.

Before you leave this phase — and again before the work is committed — the same
question has an exit code:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" undeclared --base <the branch point>
```

Non-zero means source changed and no node of that surface moved. The check above is
judgment and this one is not, which is the point: the instruction to write the node
first has been read and skipped often enough to be measured — 103 of 151 behaviour
pull requests on the first repo this ran against, 94 of them adding tests.

## The loop, per node

Take **one** node. Not a batch. Not "the three related ones".

### RED — write the test, watch it fail, understand the failure

Write the test at the **consumer boundary** (invariant 4): the HTTP request, the
rendered interaction, the exported function a caller actually calls. Not the class
you imagine will do the work.

Name the test after the node, near-verbatim. When someone reads the suite output
later, they should be reading the contract back.

Then run it — narrowly, one file or one test name, so the signal is not buried:

Run the project's test command from `.keel/config.json`, scoped to this test.

Now read the failure, and check it is the *right* failure:

- Failing because the assertion was not met → correct, proceed.
- Failing on a missing import, a typo, a syntax error, an unconfigured fixture →
  **not yet RED.** Fix the test, run again. You have proven nothing about the system.
- Passing already → the behaviour exists, or your test asserts nothing. Find out
  which. If it exists, mark the node `[x]` and move on. If your test is vacuous,
  strengthen it until it fails.

State the failure you observed before writing any implementation. One line is enough.

#### When the test passes on the first run — use the mutation tool if there is one

If the project has a mutation gate configured (`mutation.gate` in `.keel/config.json`),
that is the mechanism, and it is better than doing this by hand: it tries every mutation
an operator would think of and several they would not.

```bash
node scripts/mutation-gate.mjs   # or whatever mutation.gate names
```

Read the **survivors**, not the score. Each is a missing test or an equivalent mutant
(see `${CLAUDE_PLUGIN_ROOT}/skills/bootstrap/profiles/mutation.md`). A gate failure is
not a reason to lower the threshold — that is the operator's decision about the
project, never yours about this change.

Where no mutation runner exists for the surface, do it by hand as below.

This happens whenever you are covering behaviour that already exists — closing a gap
rather than adding a capability. A test that has never failed still proves nothing,
so witness RED the other way round: **break the implementation on purpose and
confirm the test catches it.**

Change one thing the node depends on — invert a condition, drop half of a compound
check, widen a comparison to a presence check, remove an early return — run the
narrow test, and confirm it fails. Do this once per group of related nodes, not once
per test.

**Use `keel mutate` rather than editing the file yourself:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" mutate <file> \
  --find "<the exact text to break>" --replace "<what to break it to>" \
  -- <the narrow test command>
```

It applies the mutation, runs the command, restores the file from a snapshot taken
outside the repo, and verifies the restore byte-for-byte. It exits zero when the
mutant was **killed** and non-zero when it **survived**, so the verdict is a status
code rather than something you read off the screen and interpret.

This exists because the instruction below it used to be the whole mechanism, and an
agent that had read it still destroyed uncommitted work twice in one session by
restoring with `git checkout <file>`. The snapshot is of the **working tree**, so
uncommitted edits in the mutated file survive.

A mutation that **survives** is the most valuable result available in this phase: it
means the behaviour is unguarded and your test does not cover the case you thought
it did. Add the missing test before moving on, then re-run the mutation to see it
caught.

If you mutate by hand anyway, restore from a **copy**, never with `git checkout
<file>` — that reverts every uncommitted change in the file, not just the mutation.
Then confirm with a checksum, not with `git diff`: a diff is non-empty whenever the
file holds legitimate uncommitted work, so it cannot tell you whether the mutation
is gone. A forgotten mutation is a real defect shipped by the process meant to
prevent them.

### GREEN — the smallest change that passes

Write the least code that makes that test pass. Resist:

- Adding a layer of indirection you do not yet need.
- Handling cases no node describes and no test drives.
- Generalising to the shape you predict the next node will want.

Every one of those is an agent adding unpaid-for complexity, and none of it is
covered by a test that has ever failed. If you find yourself wanting an
abstraction, note it and let the third node demand it.

Run the test. Show the command and the actual output (invariant 3).

### REFACTOR — only with green in hand

With the test passing, improve the code you just wrote: naming, duplication,
placing logic at the right layer. Re-run after each change. If a refactor turns the
suite red, revert it rather than chasing it — you are meant to be changing
structure, not behaviour.

Match the surrounding code. Its conventions, its error handling, its test setup
helpers. Code that reads as foreign is a defect even when correct.

### Close the node

Mark the node `[x]` in the contract file. Then take the next one.

## While you work

- **Never** mark a node `[x]` without having seen its test pass in this session.
- If a node turns out to be wrong or impossible as written, stop and say so. Do not
  build a near-neighbour of it and mark it done — go back to `/keel:change`.
- If you cannot make a node work, mark it `[!]` with the reason and continue with
  the others. Report it. A partial result honestly reported is useful; a partial
  result presented as complete is worse than nothing.
- Broken unrelated tests are your problem too. If your change broke something, that
  is your change. If it was already broken, say so with evidence.

## Leaving this phase

Run the full suite for the surface you touched — not just your own tests — and show
the output.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger tdd "<domain>: N/M nodes green, RED witnessed on each; <anything left open>"
```

Report per node: green, still open, or broken with a reason. Then hand to
`/keel:verify`. Do not tell the operator the work is done — `verify` decides that.
