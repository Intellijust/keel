---
name: install
description: "Install Keel into a project: probe the stack, write the mental model, seed contracts from the behaviour that already exists, wire the feedback commands, and add project-local steering. Triggers when the operator asks to set up, install, configure, bootstrap, or onboard Keel or the harness for a project, asks to seed or backfill contracts from existing code, or asks to configure test/lint feedback for a coding agent."
---

# INSTALL — wire the harness into this project

Read `${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` if you have not this session.

Installing is itself a four-step arc: **probe → propose → install → prove.** The
last step is not optional. An installed harness that has never been run is a
decoration, and the operator will find out at the worst moment.

## 1. Probe

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" probe
```

Then read what the probe cannot know:

- The **CI workflow** — whatever CI runs is the project's real definition of "green",
  and Keel's commands should match it rather than inventing a parallel standard.
- The **existing conventions file** — `CLAUDE.md`, `AGENTS.md`, `.cursor/rules`.
- **One existing test per surface**, in full. You need its real invocation and setup
  conventions, not a guess at them.
- Any **profile** in `${CLAUDE_PLUGIN_ROOT}/skills/install/profiles/` matching this
  stack. Read it if one applies; they carry the specifics this skill deliberately
  does not hardcode.

## 2. Propose

Present the operator a concrete plan before writing anything:

- **Surfaces** — the units that get their own contracts and their own test command.
  In a monorepo that is per app or package, not one blurred root.
- **Commands** — `lint`, `test`, `testChanged`, `build`, and `e2e` if it exists.
  Take them from CI where possible. Real, runnable, copy-pasteable commands.
- **Contract seeding** — how much existing behaviour to write down now. Options,
  cheapest first:
  - *Thin* — an empty contract file per surface. The harness starts working
    immediately; contracts fill in as changes happen.
  - *Seeded* — read the existing tests and write their proven behaviour as `[x]`
    nodes. Expensive on a large codebase, and worth it, because it turns the test
    suite into a readable specification.
  - *Seeded on demand* — thin now, and `/keel:change` seeds a domain the first time
    it touches it. **Recommend this** for anything beyond a small project.
- **Steering** — what goes into the project's own config so the harness holds
  without anyone remembering it (see step 3).

Ask which seeding depth they want. That is the one choice here with a real cost
difference.

## 3. Install

Write `.keel/config.json` at the project root:

```json
{
  "contracts": "contracts",
  "commands": {
    "lint": "<real command>",
    "test": "<real command>",
    "testChanged": "<real command, or omit>",
    "build": "<real command>",
    "e2e": "<real command, or omit>"
  },
  "surfaces": [
    { "name": "api", "root": "apps/api", "tests": "apps/api/src/**/*.spec.ts" }
  ]
}
```

Every command must be one you have **actually run successfully** in this session.
A command copied from a README and never executed is the most common way an install
looks complete and is not.

Then:

- Create `contracts/` with a short `README.md` pointing at the doctrine and the
  marker legend, plus a file per surface at the agreed seeding depth.
- **Write `MENTAL_MODEL.md`** — see the section below. This is not optional; the arc
  skills read it on every change.
- Add a **Keel section to the project's conventions file** (`CLAUDE.md` or
  `AGENTS.md`, creating it if absent): the five phases in two lines, the invariant
  that behaviour changes start at `/keel:change`, and where contracts live. This is
  what steers agents that never invoke a skill.
- Add `.keel/ledger.md` and `.keel/plans/` to the repo. They are project history and
  belong in version control — do not gitignore them.

### Vendor the engine, if CI will run it

Skills invoke the plugin's engine directly, so nothing above needs a local copy. CI
does: a pull-request checkout has no plugin installed, and a workflow step calling
`${CLAUDE_PLUGIN_ROOT}` there resolves to nothing.

So **if any CI job, hook, or npm script will invoke Keel**, vendor it:

```bash
cp "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" .keel/keel.mjs
node .keel/keel.mjs version
```

Commit it. It is a real dependency of the pipeline, not a build artefact.

If nothing but skills will ever run Keel here, do not create it, and say that you did
not — an absent vendored copy is a decision, and `doctor` stays silent about it
precisely so that decision is not nagged at.

Either way, tell the operator the rule that follows: **the copy never moves on its
own.** `keel doctor` warns once it falls behind the installed plugin, or once it
declares the same version while differing byte-for-byte — somebody having fixed one
repo and forked the engine for everyone. `/keel:update` is the way back, in its own
commit.

### The mental model

Read `${CLAUDE_PLUGIN_ROOT}/docs/MENTAL-MODEL.md` first. Seven sections, one rule:
**it holds only what you cannot recover by reading the code.**

Draft it from what you can actually establish — the README, the git history, the
domain nouns in the schema, the layering the imports reveal, comments that explain a
*why*. Long explanatory comments are the richest source here: someone already wrote
down a reason, and reasons are exactly what belongs in this file.

Then close the gaps with the operator. Ask about the things code cannot answer, in
this order of value:

1. **Purpose** — who is this for, and what goes wrong in their life without it?
2. **Dangerously similar words** — which pairs of domain terms get confused, and
   what breaks when they are?
3. **Invariants** — what must never be true, no matter what a feature request says?
4. **Decisions that look wrong** — what would a newcomer try to "fix" that must stay?
5. **Sharp edges** — what has already bitten someone?

Ask these as a short batch, not one at a time. Where you cannot get an answer,
**record the gap as an `> UNKNOWN:` note in place** — a guessed entry is worse than a
gap, because every later change is reasoned from it.

Then make it reach context automatically. Add to the project's conventions file:

```markdown
@MENTAL_MODEL.md
```

Claude Code resolves that import, so the model is in context on every session without
anyone remembering it. Verify it landed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" model
```

If the project is also driven by agents that do not resolve `@` imports, offer a
`SessionStart` hook that prints the file instead. Offer — an operator who does not
need it should not carry it.

**The undeclared gate — propose this one, do not merely list it.** `keel undeclared`
is the only mechanism that makes invariant 1 observable, and it is worth nothing if
nothing runs it. It reads a diff and parses markdown, so it is far under the
"fast enough to be worth the interruption" bar the next paragraph sets. Propose both ends:
a pre-commit hook running `undeclared --staged`, which is fast because it reads a
diff and parses markdown, and a CI step on the pull request running
`undeclared --base "origin/$BASE_REF"`. Measure it on the repo's own history first
and tell the operator the real failure rate before they turn it on — on the first
repo it was measured against, 106 of 151 behaviour pull requests failed it, which is
information the operator needs rather than a reason to soften the gate.

If the operator declines, say so plainly and move on — `doctor` will carry a standing
warning that nothing invokes the gate, which is the honest record of that choice
rather than a nag.

**Hooks.** Offer, do not impose. A hook that runs the full suite on every file save
makes an agent miserable and slow. Propose only hooks whose command is fast enough
to be worth the interruption — a lint on changed files after an edit, a
`testChanged` on session stop. Measure the command first and tell the operator how
long it took. If nothing is fast enough, say so and install no hooks.

## 4. Prove

Do not report a successful install until you have:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" doctor
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" contracts
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" model
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" unknowns
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" version
```

`version` should report the vendored copy as current, or report that there is none
because you decided against one. Anything else means the copy was made from something
other than the engine you are running.

Mutation testing is not part of a bare install — it needs tests worth mutating first.
`/keel:bootstrap` sets it up. If the project already has a real suite, offer it now and
point at `${CLAUDE_PLUGIN_ROOT}/skills/bootstrap/profiles/mutation.md`.

both clean, **and** every configured command executed once with its output shown.
Then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger note "installed: N surfaces, commands verified, seeding=<depth>"
```

## 5. Hand over

Tell the operator, briefly: where contracts live, the five phases, and that their
next behaviour change should start with `/keel:change`. Offer to run one small real
change through the whole arc — an install proven on a real change is the only one
you know works.
