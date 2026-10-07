---
name: ship
description: "Run the whole Keel arc from idea to proven working software — contract, plan, TDD, verify, review — in one pass. Triggers when the user wants the full workflow, asks to take an idea all the way through implementation, asks you to handle something end to end, says to just get it done, or passes --auto to skip the phase confirmations."
---

# SHIP — the whole arc

Read `${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` now if you have not this session.
You are about to run every phase, so you need every invariant.

This skill removes the operator's phase confirmations. **It does not remove a single
gate.** Autonomy means you stop asking; it never means you stop checking. An arc
that skipped RED, or reported green without output, has failed no matter what it
produced.

## The arc

Run each phase by following its skill, in order:

1. **`/keel:change`** — write the contract nodes.
   With `--auto`: instead of asking the operator to confirm the wording, state the
   nodes and the assumptions you made explicitly, then proceed. Assumptions stated
   in passing do not count — list them.
2. **`/keel:plan`** — only if the change touches more than one file, has ordering
   risk, or involves data migration. Skip it for a genuinely small change and say
   that you skipped it. Never skip it to save time on something large.
3. **`/keel:tdd`** — one node at a time, RED witnessed on every single one.
4. **`/keel:verify`** — run the real commands, quote the real output, sweep all five
   drift axes.
5. **`/keel:review`** — only for non-trivial work, and only once, at the end.

## Stop conditions

Running unattended does not mean running through a wall. Stop and return to the
operator when:

- A contract node turns out to be **wrong or impossible** as written. Do not build a
  near-neighbour and call it done — that is the single worst outcome available to you.
- The same test fails **three times** and you do not understand why. Report the
  failure and what you tried. Do not start deleting assertions, adding
  `skip`, loosening matchers, or mocking the thing under test.
- The change starts to require **a decision the operator owns** — a schema
  migration, a breaking API change, a new dependency, a security tradeoff.
- Pre-existing tests were **already failing** before you started. Say so, with
  evidence, and ask whether to proceed.

Never resolve a blocker by weakening the check that revealed it.

## Reporting

One report at the end, in this shape:

- **What now holds** — the nodes that went `[x]`, with the command output that proves it.
- **What does not** — nodes left `[ ]`, `[~]`, or `[!]`, each with its reason.
- **What I decided for you** — every assumption you made in place of asking.
- **What I found on the way** — drift, pre-existing breakage, review findings.

The ledger already carries a line per phase; the report is for the human.

If any part of the arc could not be completed, lead with that. Do not open with a
success summary and bury the gap in the fourth bullet.
