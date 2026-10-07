# The mental model

A codebase tells you *what* it does. It is almost silent about what it is **for**,
which words mean what, which truths must never break, and which apparently-odd
choices are load-bearing. An agent reading only code reconstructs a plausible
version of that missing knowledge — and a plausible version is exactly the
dangerous kind, because it will be defended with confident, well-tested code.

`MENTAL_MODEL.md` is where that knowledge lives. It is the frame the contract sits
inside: the contract says what should be true, the mental model says what kind of
system it is being true *about*.

## The boundary rule

This is the whole discipline, and without it the file becomes a second README that
contradicts the first:

> **The mental model holds only what you cannot recover by reading the code.**

Apply it ruthlessly. Three tests before anything goes in:

- Could a careful reader derive this from the source in ten minutes? → **it belongs
  in the code**, not here.
- Is it a statement about what *should* be true of behaviour? → **it belongs in
  `contracts/`**.
- Is it a command, a path, a convention, or a how-to? → **it belongs in `CLAUDE.md`
  or the README**.

What survives all three is genuinely unrecoverable: purpose, vocabulary, invariants,
the reasons behind decisions, and the location of the sharp edges.

## It must stay short

A mental model nobody holds in mind is not a mental model. Past roughly **200
lines** it has started absorbing material that belongs somewhere else — go find it
and move it. Length is the reliable symptom of the boundary rule slipping.

Being short is also what makes it affordable to keep in context on every change,
which is the only way it changes any outcome.

When `keel model` reports you over the limit, **do not trim prose.** Apply the
boundary rule instead and find the entry that fails it — a reason already written in a
code comment is recoverable and does not belong here; a layer listing is recoverable
from the file tree; a gap already recorded in the testing strategy is a duplicate.
Cutting words gets you under the limit and leaves the file wrong. Cutting misplaced
entries is the point of having a limit at all.

Removing an entry can orphan a cross-reference elsewhere in the file. Check.

## The seven sections

Each one exists because agents reliably get that specific thing wrong.

### 1. What this system is for

One paragraph: the purpose, and who it serves. Not a feature list — features are
recoverable from routes and screens. The purpose is not.

*Why it earns a section:* without it, an agent optimises for local plausibility. It
will build the feature you asked for in a way that quietly serves nobody, because it
never knew who it was for.

### 2. Vocabulary

The domain nouns, defined precisely — and above all, **the ones that are dangerously
similar**. Where two words look interchangeable and are not, say so explicitly, and
say what happens if they are confused.

Also name any term this project uses in a sense that differs from its common
meaning. That single list prevents more defects than any other part of this file.

*Why it earns a section:* an agent will use two near-synonyms interchangeably, write
tests that pass, and produce a system that conflates two things the business
carefully separates.

### 3. Invariants that must never break

Truths about the whole system that no change may violate. Not behaviour of one
feature — cross-cutting facts, usually about isolation, identity, money, or
irreversibility.

Write each as a flat statement of what must always hold, and where it is enforced.
If it is enforced in more than one place, that is worth knowing; if it is enforced
in none, say that too — an aspiration labelled as an invariant is worse than no
entry.

*Why it earns a section:* these are the failures where a plausible change is a
catastrophe, and where the tests usually still pass.

### 4. The shape

The layers or boundaries and the allowed direction of dependency. What may call
what. Where the seams are.

Keep it to the direction and the reason. The file tree is recoverable; the rule that
`services` must never import from `routes` is not, until someone has broken it.

*Why it earns a section:* left to itself an agent puts new code wherever the
imports are easiest, which is how a layered system quietly stops being one.

### 5. Decisions already made, and why

The load-bearing choices, each with the reason that made it right — and especially
**the ones that look wrong and are not**. If a previous approach was tried and
abandoned, record that; an agent will otherwise rediscover it enthusiastically.

*Why it earns a section:* an agent shown something surprising treats it as a defect
and helpfully "fixes" it. The reason is the only defence a decision has.

### 6. Sharp edges

The parts that are fragile, surprising, or have already bitten someone. For each: what
it is, and what to read before touching it.

This is the section a returning human actually values, and the one that most
reliably saves an agent from a self-inflicted wound.

*Why it earns a section:* nothing in the code marks itself as dangerous.

### 7. What this system deliberately does not do

Scope boundaries. The things that look like obvious omissions and are decisions.

*Why it earns a section:* agents are helpful. Without this, they add the missing
thing.

## Keeping it honest

The mental model is the slowest-moving artifact in the repo and the most damaging
when it drifts, because everything else is derived from it. `/keel:verify` sweeps it
as **drift axis 6**, checked whenever a change touches something the model describes
rather than on every single verify.

The failure mode to watch for is not staleness but **flattery**: a model that
describes the system someone intended rather than the one that exists. When the two
disagree, the code wins the description and the disagreement gets reported — it is
usually the most interesting thing anyone will learn that week.

## Unknowns are written down, not guessed

If the purpose, a definition, or a reason cannot be established from the code, the
git history, or the operator, it is recorded as an open question in place:

```markdown
- **Cub / Scout** — two learner bands, split by age.
  > UNKNOWN: what happens to a Cub's data when they age into Scout — carried over,
  > or archived? Nothing in the code decides this. Needs an operator answer.
```

A guessed entry in this file is worse than a gap, because every later change will be
reasoned from it.

### Unknowns have a lifecycle, not a graveyard

A question written down and never asked again is worse than useless: it looks like
diligence while functioning as a permanent excuse. Recorded unknowns are therefore
tracked, aged, and surfaced until they are answered.

```bash
keel unknowns          # every open question, with how long it has gone unanswered
```

Age comes from `git blame`, so nobody has to remember to date anything, and an unknown
cannot quietly reset by being reformatted.

**They surface in three places, deliberately at different volumes:**

- **`/keel:change`** asks the ones whose section covers the domain being changed. This
  is the important one — a question asked while the operator is already thinking about
  that area gets answered; the same question asked at random does not.
- **`/keel:verify`** reports any unknown the change touched, answered or not.
- **The commit hook** prints stale ones as a **warning, never a block.** An unanswered
  question is a prompt to ask, not a reason to stop work. Blocking commits on it
  teaches people to delete questions rather than record them, which is the exact
  opposite of the goal.

`keel unknowns` exits non-zero past the configured age (30 days by default), so a
project that wants a harder gate can have one — but make that the operator's choice.

**Resolving one** replaces the `> UNKNOWN:` block with the answer as an ordinary
entry, and records it in the ledger:

```bash
keel ledger note "resolved unknown: <question> — <the answer>"
```

The ledger entry matters because the answer usually arrives in conversation, and the
conversation is the thing that disappears. Never delete an unknown without recording
either its answer or the reason it stopped mattering.
