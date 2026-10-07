---
name: review
description: "Get an independent adversarial review of completed work against its contract, from a reviewer that did not write it. Triggers when the user asks for a second opinion, an independent review, a critique, a final check before a PR or release, or asks what could be wrong with the work just finished. Also runs as the final phase of the Keel arc after /keel:verify."
---

# REVIEW — try to refute it

Read `${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` if you have not this session.

An author cannot review their own work, because they read their intentions back
into the code and see the version they meant to write. This phase exists to get a
reader who has no intentions to project.

Do not run this on trivial changes. It costs real time and its value comes from
being reserved for work that would hurt if it were wrong.

## 1. Assemble the packet

The reviewer gets exactly this, and nothing about how the code came to be:

- The **contract nodes** in scope, verbatim from `contracts/`.
- The **diff** — `git diff` against the base branch, or the staged/working changes.
- The **verify output** from the previous phase: what ran, what it said.
- The project's own conventions file if one exists (`CLAUDE.md`, `AGENTS.md`).

Deliberately withhold your reasoning, your plan, and your explanations of why
choices were made. Those are exactly what would contaminate the review — a reviewer
told why something is right will find reasons it is right.

## 2. Get the review

**Preferred — a different model.** A genuinely independent reader catches what a
same-model reviewer rationalises. If the operator has configured one in
`.keel/config.json` under `review.model` (or an accessible local inference
endpoint), send the packet there with high reasoning effort.

**Default — a blind subagent.** With nothing configured, use an isolated subagent
that has none of this conversation's context. Give it the packet and this brief:

> You are reviewing a change you did not write. Your job is to refute it, not to
> approve it. Read the contract nodes, then read the diff, and find where the code
> fails to deliver a node, delivers it only for the tested input, or introduces a
> defect nobody asked about. Report only findings you can state as a concrete
> failure: specific input or state, and the wrong result it produces. If you cannot
> construct that failure, do not report the finding. Say plainly if you find nothing.

Do not spawn a subagent if the operator has asked you not to use them; do the pass
yourself, but read the diff cold, from the top, as a stranger would.

## 3. What the review must look for

Direct the reviewer at the failure modes agentic code actually has, in this order:

1. **Node not really delivered** — the test passes on its one input; the node is
   false for a neighbouring one.
2. **Untested edge on a path the change touched** — empty, null, zero, duplicate,
   expired, concurrent, unauthorised, wrong tenant.
3. **Assertion theatre** — tests that execute the code without pinning behaviour:
   asserting a mock was called, asserting truthiness, snapshotting whatever
   happened.
4. **Security and access** — can a caller reach data or an action they should not.
   Check this on every change that touches a route, a guard, or a query filter.
5. **Unrequested complexity** — abstraction, configurability, or generality that no
   node asked for and no test would miss.
6. **Silent behaviour change** — something outside the contract that now behaves
   differently.

## 4. Triage, do not obey

The review is evidence, not instruction. For each finding, decide and say:

- **Confirmed** — reproduce it if you can, then fix it, or write it as a `[!]` node
  if fixing is out of scope.
- **Wrong** — say why, with the specific reason it does not hold. A reviewer that
  invents a failure has cost you nothing if you check it.
- **Real but out of scope** — record it as a `[ ]` or `[~]` node so it is not lost.

Report the findings and your triage to the operator, including the ones you rejected
and why. A review whose rejections are hidden cannot be audited.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger review "N findings: X fixed, Y rejected, Z logged as nodes"
```
