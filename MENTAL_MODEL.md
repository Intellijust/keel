# Mental model — Keel

What this repo's code cannot tell you. **Only what is unrecoverable from source**:
the whys live in `docs/DECISIONS.md`, the method in `docs/DOCTRINE.md`, commands in
`CLAUDE.md`. This file does not restate them.

---

## 1. What this system is for

Keel steers coding agents toward software that does what was asked, in any repo, in
any language. An agent is fast, tireless, and eager to report success; Keel changes
what it has to pass *through* rather than what it is told. The customer is a
developer (the **operator**) whose agent writes plausible code and claims green —
Keel makes the claim impossible without the evidence.

It ships as a Claude Code plugin: nine skills (prose, read by agents) around one
dependency-free engine (`scripts/keel.mjs`) that computes the facts the skills act
on. The skills persuade; the engine measures. Nothing here executes in production —
its blast radius is the quality of *other* repos.

**Release and re-vendor.** The plugin's `scripts/keel.mjs` is the source of truth;
each consuming repo holds a vendored copy. A change ships as a plugin version bump,
and each consumer re-vendors in **its own commit** — never folded into a feature
change, so "the engine moved" is always its own reviewable line in history. Formats
(contract, ledger, `.keel/config.json`) stay backward-compatible across 0.x: a
consumer running an older vendored engine against newer files, or the reverse, must
not break. Answered 2026-08-27.

**Audience: public, under Intellijust.** *Answered 2026-10-02, settled 2026-10-07.*
Keel is published at `github.com/Intellijust/keel` under MIT. That decides the
question above in the stricter direction: the formats owe strangers the same
compatibility the 0.x rule already promises, and from the first public tag a repo
nobody here has seen can be running any older vendored engine against any newer
file. A format change is now a breaking change for people who will not file an
issue — they will simply stop using it.

The consequence that bites hardest: the heuristics tuned on a single NestJS/React
repo (§6) stopped being a private convenience the moment this went public. They are
contracted and tested as of 2026-10-02, and the property that makes them safe on an
unfamiliar stack — an unrecognised filename is a `module`, which is a gated kind —
is now pinned by a test rather than true by accident.

## 2. Vocabulary

**Node vs test** — a node is agreed *behaviour* (`rejects an expired token with
401`); a test is evidence for one. Ten tests of one behaviour is one node. Progress
is counted in nodes moved, never tests written.

**Open `[ ]` vs deferred `[~]`** — open is the work queue; deferred is work
*consciously not being done*, and must carry a reason. Marking something deferred to
shrink the queue is the exact failure the marker exists to expose.

**Gate vs ratchet** — a gate breaks the commit now (changed-file mutation score); a
ratchet only forbids regression (full-suite score). Confusing them produces either a
gate nobody can pass — which gets switched off within a week — or a ratchet nobody
notices.

**The plugin's engine vs a vendored copy** — `scripts/keel.mjs` here is the source
of truth; consuming repos hold a copy in `.keel/keel.mjs` so CI works from a plain
clone. Fixing a bug in a vendored copy fixes one repo and silently forks the engine.

**Skill vs engine** — skills are routing-triggered prose; the engine is executable.
A behaviour placed in a skill is advisory and dies on contact with habit; placed in
the engine it is mechanism. When something must *always* happen, it belongs in the
engine (proven on 2026-08-26: the tdd skill's restore-from-a-copy instruction was
read and still violated twice in one session).

## 3. Invariants that must never break

1. **The engine stays one dependency-free file.** Vendorability is the deployment
   model; a second file or an npm dependency breaks every consuming repo's plain
   clone. *Enforced by:* nothing but this sentence.
2. **The engine never persists an edit to source.** A mutation applied to witness
   RED is restored before exit and verified byte-identical; everything else it
   writes is confined to `.keel/`. It never commits and never lowers a threshold —
   skills instruct, the operator decides. *Amended 2026-08-27:* this read "never
   edits source", which `keel mutate` would have broken. The protection wanted is
   against edits that *survive* the command, not against the transient one whose
   whole purpose is proving a test can fail. *Enforced by:* convention, plus
   `mutate`'s own restore-and-verify.
3. **Exit codes are the API.** Skills and CI branch on them (`contracts --open`
   non-zero on an unreasoned `[~]`/`[!]`; `doctor` non-zero on a broken install).
   Changing one silently breaks consumers that cannot read prose.
4. **Skills reference `${CLAUDE_PLUGIN_ROOT}`, never absolute paths** — they must
   work from any install location.
5. **A gate's own tooling is itself gated.** A measuring instrument with no tests
   passed two real defects in its first consuming repo (2026-08-26). This repo does
   not get to skip its own doctrine.

## 4. The shape

Nine skills under `skills/<name>/SKILL.md`: five are the arc, `ship` runs it, and
`install`, `bootstrap` and `update` are the lifecycle around it. Stack specifics are
demoted to `profiles/`. One engine, `scripts/keel.mjs`: a command switch
over pure-ish functions (`probe`, `contracts`, `untested`, `undeclared`, `model`,
`unknowns`, `mutation`, `ledger`, `doctor`) that read the consuming repo's files and print
facts. It shells out to `git` (blame, diff) and reads Stryker's JSON reports; it
starts no servers and installs nothing.

`.claude-plugin/` is the marketplace manifest — the plugin's identity, not code.

## 5. Decisions already made, and why

`docs/DECISIONS.md` is the authoritative record — including the two overridden
objections (the mental model, restored with a boundary rule; mutation testing,
restored as two scoped gates). It is unusually complete; read it before proposing a
change, because the obvious simplification has usually been argued already. Not
restated here on the boundary rule this file lives under.

## 6. Sharp edges

**`parseContract` is the format.** No schema exists: whatever its regexes accept
*is* a valid contract file, and every consuming repo's `contracts/` depends on that
staying stable. A "small" parser fix can reclassify nodes in repos this code has
never seen.

**`blameAgeDays` shells to `git blame` per unknown** — wrong or slow in shallow
clones, worktrees, and repos with rewritten history; silently absent when git is.

**`untested`'s `kindOf` heuristics decide what counts as inert** (dto, module,
barrel…). They were tuned on one NestJS/React repo; on a different stack they can
exclude real behaviour from the backlog without saying so.

**Editing a file the agent is also hand-mutating loses work.** Twice in one session
an agent restored a hand-mutation with `git checkout <file>` and reverted its own
uncommitted edits with it. Until RED-witnessing is sandboxed in the engine, any
uncommitted edit in a file being mutated is one habit away from deletion.

## 7. What this system deliberately does not do

- **No architecture linting, no README hooks, no presentation tooling** — recorded
  with reasons in `docs/DECISIONS.md`.
- **No network access and no API keys.** Review independence comes from withholding
  context, not from a second vendor; a different model is an upgrade, not the
  mechanism.
- **No enforcement inside the engine.** It reports and exits non-zero; blocking is
  CI's and the hooks' job in the consuming repo.
- **No self-update.** A consuming repo's vendored engine changes only when a human
  re-vendors it. *Clarified 2026-08-31:* `/keel:update` is that human's tool, and it
  holds the rule by being operator-invoked only — never from a hook, a session start,
  or inside another skill — and by landing in its own commit. The engine reports
  staleness (`keel version`, a `doctor` warning); it never acts on it. Nothing in
  Keel writes an engine, which is also why re-vendoring is a skill and not a
  `keel update` command.
