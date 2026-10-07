# The Keel doctrine

A coding agent is fast, tireless, and eager to report success. Left alone it will
write plausible code, assert that the tests pass, and hand you something that
compiles but does not do what you wanted. Every rule below exists to close one of
those specific gaps.

The harness is not a style guide. It is a set of gates that make the failure modes
of agentic development structurally hard to reach.

## The five phases

| Phase | The question it answers | Artifact it produces | Gate to leave it |
|---|---|---|---|
| **CONTRACT** | What should be true when this is done? | Nodes in `contracts/` | Operator agrees the wording. Zero code touched. |
| **PLAN** | How, in what order, and what could break? | A plan, smallest-step-first | Operator approves. Still zero code touched. |
| **TDD** | Make it true, one node at a time | Failing test → passing test → refactor | Every node saw RED before it saw GREEN |
| **VERIFY** | Is it actually true, and is anything drifting? | Real command output + drift sweep | Commands ran; output quoted; drift resolved or recorded |
| **REVIEW** | What did we miss? | Adversarial critique | Findings triaged: fixed, or logged with a reason |

Phases move forward on the operator's word. The operator may collapse them
(`/keel:ship`), but the gates still fire — autonomy removes the asking, never the
checking.

## The nine invariants

**1. No code before contract.**
If a change alters observable behaviour and no contract node describes it, the node
gets written first. Not after, not "as I go". The contract is what makes
"done" a fact rather than an opinion.

**2. RED is mandatory and must be witnessed.**
A test that has never failed proves nothing — it may be asserting something already
true, or nothing at all. Run the new test, watch it fail, and confirm it failed
*for the reason you expected*. A test that fails on a typo or a missing import has
not been witnessed.

**3. Green is a quotation, never a claim.**
"Tests pass" is worthless on its own. Any such statement carries the command that
was run and its actual output, in the same turn. If the output is not shown, the
tests did not run.

**4. One node at a time, outside-in.**
Start at the consumer boundary — the HTTP request, the UI interaction, the public
function someone actually calls. Let inner collaborators be discovered because a
test demanded them, not designed up front because they seemed likely. Designed-up-front
collaborators are how agents produce three layers of indirection for one `if`.

**5. Contract nodes describe behaviour, not structure.**
`rejects an expired refresh token with 401` is a node.
`AuthService has a validateRefresh method` is not — it is an implementation detail
wearing a contract's clothes, and it locks in a design before anyone has learned
whether it is the right one.

**6. Drift is a defect.**
A contract node with no test, a test asserting behaviour no node describes, a README
promising something the code stopped doing — each is a bug of the same severity as a
crash, because each one silently invalidates the map everyone is navigating by.

**7. Deferral is explicit and reasoned.**
Work you are consciously not doing is marked `[~]` with a reason. Silently dropping
a node is the single most common way agent work appears complete while being partial.

**8. A measuring instrument is itself measured.**
Any tool whose output decides whether work passes — a mutation gate, a coverage
threshold, a custom lint, the harness's own engine — must have been *seen to fail*.
Not reasoned about: run it against something broken and watch it say so. A gate that
has only ever printed "pass" is not known to be a gate, and its green is worth
exactly nothing. This is the runner rule from `bootstrap` generalised: a tool that
has never observed a real failure is not known to work. Two defects were found by
inspection in the first such tool Keel shipped, both of which would have passed
broken work silently — one reported a stale report as a fresh run, the other let a
real bug through as "0 mutants on changed lines".

**9. Review is adversarial and blind.**
The reviewer is told to refute, not to admire, and it never saw the code being
written. An author reviewing their own work re-reads their own intentions into it.

## The mental model

`MENTAL_MODEL.md` holds what the code cannot tell you: what the system is for, which
words mean what, which truths must never break, why the load-bearing decisions were
made, and where the sharp edges are. The contract says what should be true; the
mental model says what kind of system it is being true *about*.

It is imported by the project's conventions file so it is in context on every change,
and it is governed by one rule — **it holds only what you cannot recover by reading
the code**. See `docs/MENTAL-MODEL.md` for the seven sections and the discipline that
keeps it from becoming a second README.

## Contract node format

One file per domain under `contracts/`, each with a frontmatter block naming where
its tests live. Headings group behaviour; list items are the nodes; nesting means
"this is part of that".

```markdown
---
domain: auth
surface: apps/api/src/auth
tests: apps/api/src/auth/**/*.spec.ts
---

# Auth

## Refresh token exchange

- [x] exchanges a valid refresh cookie for a fresh access token
  - [x] rotates the refresh cookie on every exchange
  - [~] revokes the whole token family when a rotated token is replayed (deferred: needs a family table — AUTH-12)
- [x] rejects an expired refresh token with 401
- [!] rejects a refresh token issued to a deleted user (broken: returns 500 — AUTH-15)
```

| Marker | Meaning | Requirement |
|---|---|---|
| `[x]` | Behaviour holds | A test proves it, and that test has been seen to pass |
| `[ ]` | Agreed, not yet built | This is the work queue |
| `[~]` | Deferred | Must carry `(deferred: reason)` |
| `[!]` | Known broken | Must carry `(broken: reason)` |

`keel contracts --open` prints the queue and exits non-zero if any `[~]` or `[!]`
node is missing its reason.

## The axes of drift

`VERIFY` sweeps the first five every time. All but one are invisible if you only run
the tests.

1. **Intention → contract** — did we write down what the operator actually asked
   for, or a convenient neighbour of it?
2. **Contract → tests** — is any node claiming `[x]` without a test behind it?
3. **Tests → contract** — is any test asserting behaviour no node describes? Either
   the node is missing or the test is testing an accident.
4. **Contract → code** — does the code still do what the nodes say? This is the axis
   running the suite actually covers.
5. **Code → docs** — do README, API docs, and comments still describe reality?
6. **Mental model → reality** — does the model still describe the system that exists?
   Checked when a change touches something the model describes, not on every verify.
   The slowest-moving axis and the most damaging, because everything else is derived
   from it.

## What the harness deliberately does not do

- It does not review taste. Naming, structure, and elegance are the operator's call.
- It does not gate on coverage percentages. Coverage measures execution, not
  assertion; a suite can execute every line and prove nothing.
- It does not forbid deleting a contract node. Requirements change. It only forbids
  deleting one *silently*.
