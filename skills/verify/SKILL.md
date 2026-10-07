---
name: verify
description: "Prove the work with real command output and reconcile drift between intention, contracts, tests, code, and docs. Triggers when the user asks whether something is done, whether tests pass, whether the project is in sync, what is missing, what is stale, whether contracts match the code, or asks to check, prove, or double-check completed work. Also runs as the fourth phase of the Keel arc after /keel:tdd."
---

# VERIFY — is it actually true?

Read `${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` if you have not this session.

This phase answers two different questions with two different methods, and mixing
them is how false green gets reported.

- **Does it run?** — answered by executing commands. Mechanism, never judgment.
- **Is it aligned?** — answered by reading contracts, tests, code, and docs against
  each other. Judgment, and it must be done honestly.

## Part 1 — run the commands and quote them

Read `.keel/config.json` for this project's commands. Run them in this order,
stopping to fix or report rather than pressing on past a failure:

1. **lint** — cheapest signal, catches the most.
2. **test** — the whole suite for every surface you touched. Not the subset you
   wrote. A change that fixes your node and breaks two others is not progress.
3. **build** — type errors and bundling problems that tests never see.
4. **e2e**, if configured and the change touches a user-facing path.
5. **undeclared** — did this change move a contract node at all?

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" undeclared --base <the branch point>
   ```

   Non-zero means behaviour source changed and no node of that surface moved, which
   is invariant 1 broken — go back to `/keel:change` and write the node, or exempt
   the change with a reason if it genuinely describes no behaviour. Do not reach for
   `--exempt` to get a green; the reason is recorded and a reviewer will read it.

6. **mutation**, if `mutation.gate` is configured — scoped to the files this change
   touched. Then read the score off the report rather than the console, so the number
   is a fact and not a recollection:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" mutation
   ```

   Report the survivors, not just the score. A passing gate with three survivors is
   three pieces of unpinned behaviour, and saying so is the useful part.

For each: show the command and its real output (invariant 3). Trimming noise is
fine; paraphrasing the result is not. `214 passed, 0 failed` is a quotation.
"Everything passes" is a claim, and claims are what this harness exists to stop.

If a command is slow, run it anyway. If it cannot run in this environment, say so
explicitly and name what is therefore unproven — never let an unrun command pass as
a passing one.

## Part 2 — sweep the five axes of drift

Take them in order. Four of these are invisible to the test suite, which is exactly
why they are worth the time.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts
```

**Axis 1 — intention → contract.** Re-read what the operator originally asked for,
in their words. Does the contract say that, or a convenient neighbour of it? Agents
drift toward the version of a request that was easy to build. This is the axis most
worth being suspicious about, because you are auditing your own earlier reasoning.

**Axis 2 — contract → tests.** For every node marked `[x]`, find the test. Use the
`tests:` glob in the file's frontmatter as your search scope. A node with no test
behind it is not `[x]` — downgrade it and say so. Be strict: a test that exercises
the code path without asserting the specific behaviour does not count.

**Axis 3 — tests → contract.** Now the reverse. Scan the tests in that surface for
assertions about behaviour no node describes. Each one is either a missing node
(add it) or a test of an implementation accident (say so; recommend deleting it).
This axis is where real requirements hide — someone once needed that behaviour.

**Axis 4 — contract → code.** Read the implementation against the nodes. The suite
covers most of this, but look for behaviour that holds only by coincidence: an
unhandled case the test happens not to exercise, a guard that fires for the wrong
reason, an error path that returns the right status by accident.

**Axis 5 — code → docs.** Check the README, any `docs/` pages for the surface, API
schemas, and doc comments touched by this change. A doc that describes behaviour
the code stopped having is a defect with a long tail — it misleads every future
reader, human and agent.

**Axis 6 — mental model → reality.** Only when the change touched something
`MENTAL_MODEL.md` describes: a term in its vocabulary, an invariant, the shape, a
recorded decision, or a sharp edge. Then verify the model still describes the system
that exists.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" model
```

That checks structure — sections present, length under the limit, imported into
context. Whether the content is *true* is yours to judge.

The failure to watch for is not staleness but **flattery**: a model describing the
system someone intended rather than the one that exists. Where the two disagree, the
code wins the description, and the disagreement is reported rather than quietly
edited away — it is usually the most interesting thing anyone learns that week.

This axis is checked least often and matters most, because every other artifact is
derived from it.

**Open questions.** Report any recorded unknown this change touched, whether or not it
got answered:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" unknowns
```

If the work you just did resolved one, say so and record it — the answer usually
arrived in conversation, and conversation is what disappears:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger note "resolved unknown: <question> — <answer>"
```

If the change was made *around* an unknown — building something whose correctness
depends on an unanswered question — that is a finding and belongs in the verdict, not
a footnote.

## Part 3 — verdict

Give a verdict, not a summary. One of:

- **Holds** — commands green, all five axes clean. Say so plainly.
- **Holds with gaps** — commands green, but list every gap: nodes downgraded, tests
  without nodes, docs left stale, deferrals recorded. Each gets a reason.
- **Does not hold** — something failed. Lead with what, and what it means.

Never end this phase with a reassurance. End it with a state.

Fix what is cheap and unambiguous (a stale doc line, a missing node, a downgraded
mark). For anything that needs a decision — a deferral, a rewrite, a test to delete
— ask rather than doing it silently.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger verify "<commands run and their real results>; drift: <none | the list>"
```

## Leaving this phase

If the change is non-trivial and the verdict is Holds or Holds with gaps, offer
`/keel:review` for an independent adversarial pass before it ships.
