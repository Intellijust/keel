---
name: change
description: "Set the expected behaviour as written contract nodes before any code is touched. Triggers when the user describes a feature, capability, behaviour change, removal, bug, or modification they want — even loosely ('I want X', 'let's add Y', 'can we make it do Z', 'change how X works', 'this should really do W', 'remove that behaviour', 'X is broken'). Run this BEFORE writing code, and before /keel:plan or /keel:tdd."
---

# CONTRACT — agree what should be true

You are entering the first phase of the Keel arc. Read
`${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` if you have not this session.

Your job in this phase is **not** to build anything. It is to turn a loose human
wish into precise, testable statements of behaviour that the operator confirms.
Zero lines of implementation code are written here. If you find yourself editing a
source file, you have left the phase.

## 0. Read the mental model

`MENTAL_MODEL.md` should already be in context via the project's conventions file. If
it is not, read it now — you cannot write a contract in a domain whose vocabulary you
are guessing at.

Use it for three things: the **vocabulary** (name behaviour in the project's words,
not near-synonyms), the **invariants** (a request that would break one is a request to
escalate, not to implement), and **what the system deliberately does not do** (the
request may be asking for something already decided against).

If the request contradicts the mental model, say so before writing any node. That is
a conversation about the model, not about the contract.

## 1. Locate the surface

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts
```

If this fails because there is no contracts directory, run `/keel:install` first
and come back.

Identify which contract file governs the behaviour under discussion. Read it in
full — you cannot extend a contract you have not read, and the existing nodes tell
you the vocabulary and grain this project uses.

If no file governs it, you are opening a new domain: create
`contracts/<domain>.md` with the frontmatter block from the doctrine, pointing
`tests:` at where tests for that surface actually live (check, don't assume).

## 2. Read the code before writing the contract

Contract nodes must be true statements about intent, but they also have to be
*reachable* from where the code is now. Read the relevant implementation and its
existing tests. You are looking for three things:

- **What already holds** — do not write a node for behaviour that already works and
  is already tested. Mark it `[x]` if it is genuinely covered but missing from the
  contract; that is drift you just found.
- **What the request implicitly assumes** — most requests carry unstated
  expectations. "Add a rate limit" assumes a response shape, a scope, a reset
  window, and a behaviour on exceeding it. Surface these.
- **What the request will break** — behaviour currently marked `[x]` that this
  change contradicts. This is the most valuable thing you produce in this phase.

## 3. Draft the nodes

Write behaviour, not structure (invariant 5). Each node should be a sentence that
could become a test name and that a non-author could judge true or false by
observing the running system.

Grain guide — a node is right-sized when a single test can prove it:

- Too coarse: `handles authentication correctly`
- Too fine: `calls bcrypt.compare with the stored hash`
- Right: `rejects a login with a correct email and wrong password with 401 and no session cookie`

Include the unhappy paths. An agent left to itself writes the happy path and stops;
the operator's real risk lives in the edges — empty input, expired state, wrong
tenant, concurrent action, permission the caller does not have.

Nest sub-nodes under a parent when they are facets of one behaviour. Keep new work
as `[ ]`.

## 3b. Ask the open questions for this domain

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" unknowns
```

Any unknown whose section covers the area you are changing gets **asked now**, in the
same breath as the contract wording. This is the one moment it will get a real answer:
the operator is already thinking about this domain, and an unresolved question here may
change what the nodes should say.

Ask them as part of your proposal, not as a separate interruption, and no more than two
or three at a time. If one is answered, resolve it in `MENTAL_MODEL.md` — replace the
`> UNKNOWN:` block with the answer as an ordinary entry — and record it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger note "resolved unknown: <question> — <answer>"
```

If a node you are about to write **depends** on an unanswered question, say so plainly.
Writing a contract on top of an unresolved unknown is how a guess becomes a
requirement.

Questions from other domains stay unasked here. Nagging about unrelated unknowns is how
a team learns to stop recording them.

## 4. Name the collisions and the questions

Before showing the operator anything, state plainly:

- **Contradictions**: any existing `[x]` node this change invalidates, and what it
  should become — reworded, deleted, or deferred. Never quietly rewrite one.
- **Open questions**: the assumptions you had to make. Ask only what changes the
  work; decide the rest yourself and say what you decided.
- **Out of scope**: adjacent behaviour you deliberately did not write nodes for.

## 5. Present and confirm

Show the operator the exact nodes you propose to add, change, or remove, as a diff
in prose — added, reworded, deleted, deferred. Ask for confirmation on the wording.

This is a real gate. The wording is what "done" will mean, so it is worth one round
trip to get right. If the operator has already said to proceed without asking
(`/keel:ship --auto`), state your assumptions explicitly instead of asking, and
carry on.

## 6. Write the file and record the gate

Write the confirmed nodes into the contract file. Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts --open
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger contract "<domain>: +N nodes, ~M reworded, <one-line summary>"
```

## Leaving this phase

Tell the operator what the work queue now looks like and offer the next step:
`/keel:plan` when the change touches more than one file or has ordering risk,
`/keel:tdd` when it is small and the path is obvious.

Do not begin implementing in this turn.
