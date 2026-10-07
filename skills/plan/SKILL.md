---
name: plan
description: "Design how to fulfil a contract without changing any code. Triggers when the user asks to plan a feature, behaviour change, bug fix, refactor, or migration before implementation, asks how you would approach something, or asks what it would take. Also runs as the second phase of the Keel arc after /keel:change."
---

# PLAN — design it, touch nothing

Read `${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` if you have not this session.

This phase exists because agents are strongest at local edits and weakest at
ordering. A plan is worth writing exactly to the extent that it decides *sequence*
and *risk* — not to the extent that it restates the contract.

Zero code is written here. No edits to source, tests, or config.

## 0. Check the model before designing

`MENTAL_MODEL.md` decides two things this phase would otherwise get wrong: **the
shape** — which layer new code belongs in and which direction it may depend — and
**decisions already made**, including the ones that look wrong and are load-bearing.

An agent that has not read section 5 will propose exactly the refactor that was
already tried and abandoned. Check before proposing, and if you are genuinely
proposing to overturn a recorded decision, say that plainly rather than presenting it
as new.

## 1. Ground yourself in what exists

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts --open
```

Read the open nodes you are planning for, then read the code that will have to
change. Follow the call path from the consumer boundary inward. You are mapping
reality, not recalling it — an agent's memory of a codebase is a guess.

Specifically find:

- The **consumer boundary** for each node: the controller, route, handler, hook, or
  exported function a test will drive.
- The **existing test that is closest** to what you need. Almost always there is
  one, and following its setup conventions saves an hour of fighting fixtures.
- The **collaborators already available** — repositories, services, guards, helpers.
  Reuse beats introduction.
- The **shared code you would touch**, and who else depends on it.

## 2. Order the work by what it teaches

Sequence the nodes so each step de-risks the next. The right first step is usually
the one that would invalidate the plan if it failed — the unknown integration, the
uncertain data shape, the guard you are not sure fires. Do not start with the easy
CRUD and discover the hard part last.

For each step state: the node, the test that will drive it, the file(s) it touches,
and what has to be true for it to be possible.

## 3. Name the risks honestly

This is the part with real value. Cover only what applies:

- **Data**: migrations, backfills, nullability, whether the change is reversible.
- **Contract breakage**: existing `[x]` nodes and public API consumers affected.
- **Boundaries**: layers or modules this would couple that are currently separate.
- **Concurrency and state**: races, idempotency, retries, partial failure.
- **Auth and tenancy**: who can reach this, and can they reach someone else's data.
- **Rollout**: does anything need to ship in a specific order, behind a flag, or
  with a deploy step.

For each risk: what you will do about it, or why you are accepting it.

## 4. Offer the alternative you rejected

State the main alternative approach and why you are not taking it, in two or three
sentences. If there genuinely is not one, say so. A plan with no rejected
alternative is usually a plan that did not consider any.

## 5. Present, confirm, record

Give the operator the sequence, the risks, and the rejected alternative. Ask
whether to proceed to `/keel:tdd`.

For a plan of more than a handful of steps, or one the operator will return to,
write it to `.keel/plans/<slug>.md` so the next session can pick it up. Short plans
stay in the conversation.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger plan "<slug>: N steps, risks: <the ones that matter>"
```

If the operator asked for a visual plan, or the sequencing is genuinely hard to
follow in prose, the `visual-plan` skill renders this well — but write the plan
first.
