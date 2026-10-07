---
name: update
description: "Bring a project's vendored Keel engine up to the version of the installed plugin, and reconcile anything the newer version expects. Triggers when the operator asks to update, upgrade, re-vendor, or refresh Keel or the harness in this project, asks what version of Keel a repo is on, says the engine or .keel/keel.mjs is out of date, or acts on a doctor warning that the vendored copy is behind, ahead, or edited by hand. Operator-invoked only — never run as part of another skill, a hook, or a session start."
---

# UPDATE — re-vendor the engine, deliberately

Read `${CLAUDE_PLUGIN_ROOT}/docs/DOCTRINE.md` if you have not this session.

A consuming repo holds a copy of the engine at `.keel/keel.mjs` so CI works from a
plain clone. That copy does not move on its own, and it is not supposed to: the
mental model's rule is **no self-update — a repo's vendored engine changes only when
a human re-vendors it.** This skill is that human's tool, and it stays inside the
rule only if it keeps three boundaries:

- **Invoked, never triggered.** Not from a hook, not from a `SessionStart`, not as a
  step inside `/keel:install`, `/keel:bootstrap` or the arc. If you arrived here in
  the middle of other work, stop and finish that work first.
- **Its own commit.** Never folded into a feature change, so "the engine moved" is
  always its own reviewable line in history. If the working tree is dirty with
  unrelated work, say so and stop.
- **Nothing but the engine.** This skill does not rewrite contracts, does not touch
  source, and proposes rather than applies anything beyond `.keel/`.

## 1. Establish both versions

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" version
```

That prints the plugin's engine version and, if the repo vendors one, the vendored
version and how the two compare. Four states, and only one of them is this skill's
job:

| State | What it means | What to do |
|---|---|---|
| `current` | vendored copy is byte-identical | Nothing. Say so and stop. |
| `behind` | vendored copy is older | Re-vendor — stage 2 onward. |
| `ahead` | vendored copy is *newer* than the plugin | **The plugin is stale, not the repo.** Stage 1b. |
| `forked` | same version, different bytes | **Stop.** Stage 2. |

A repo with no vendored copy at all is not broken — skills run the plugin's engine
directly, and vendoring exists for CI. Ask whether they want one before creating it,
and if their CI never invokes `.keel/keel.mjs`, the honest answer is that they do not
need this skill at all.

### 1b. The plugin comes first

Re-vendoring copies whatever the installed plugin holds, so **a stale plugin
re-vendors staleness**. Before copying anything, confirm the plugin is itself
current: the operator updates it through Claude Code's `/plugin` interface (update
the marketplace entry, then the plugin), and you verify the result rather than
assume it:

```bash
cat "${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json"
```

You cannot update the plugin for them — that is Claude Code's machinery, not a
skill's. Ask, wait, and re-read the manifest.

## 2. Look before you overwrite

The single irreversible mistake available here is flattening somebody's local fix.
The mental model is blunt about why it matters: *fixing a bug in a vendored copy
fixes one repo and silently forks the engine* — so the fix exists nowhere else, and
overwriting it deletes the only copy.

```bash
git status --porcelain .keel/keel.mjs
git log --oneline -- .keel/keel.mjs
```

- **Uncommitted changes** to the vendored copy, or a `forked` verdict from stage 1 —
  **stop and report.** Show the operator the diff against the plugin's engine. That
  change belongs upstream in the plugin, as its own change, and only then does
  re-vendoring bring it back. Do not carry it forward by hand into the new copy;
  a hand-merged engine is the fork, one version later.
- **Commits that are not re-vendors.** A legitimate history for this file is nothing
  but re-vendor commits. Anything else is a local patch somebody made, and it needs
  the same conversation.
- **Clean, and only re-vendor commits.** Proceed.

## 3. Re-vendor and prove it

```bash
cp "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" .keel/keel.mjs
node --check .keel/keel.mjs
node .keel/keel.mjs version
node .keel/keel.mjs doctor
```

`version` must now report the vendored copy as current, and `doctor` must be at
least as healthy as it was before you started. Then run **every command that
actually invokes the vendored path** — the CI job, the pre-commit hook, whatever
`.keel/config.json` and the workflow files name — and show its real output. A
re-vendor that has not run under CI's own invocation is not known to work
(invariant 3: green is a quotation, never a claim).

### The compatibility promise, tested here

Formats stay backward-compatible across 0.x in both directions, and this is the
moment that promise is actually exercised: an older repo's files meeting a newer
engine. Run the readers over the repo's existing files with the new copy and
compare against what they said before:

```bash
node .keel/keel.mjs contracts
node .keel/keel.mjs ledger
node .keel/keel.mjs model
node .keel/keel.mjs unknowns
```

Node counts must not move. A node that changes status, a ledger entry that stops
parsing, or a new non-zero exit code is **a defect in Keel**, not something to fix in
this repo — restore the previous `.keel/keel.mjs`, report it with the file and the
output that shows it, and stop. Papering over it locally is how the parser's blast
radius gets discovered one repo at a time.

## 4. Reconcile what the new version expects

The skills came from the plugin and updated themselves. Only what `install` once
wrote *into the repo* can be stale, so run doctor and act on what is new:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" doctor
```

New warnings usually mean a config key or a file a newer install would have written.
**Propose each one; apply only what the operator approves.** A version bump is not
consent to rewrite their conventions file.

## 5. Commit it alone, and record it

```bash
git add .keel/keel.mjs
git commit -m "chore(keel): re-vendor engine <old> -> <new>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/keel.mjs" ledger note "re-vendored engine <old> -> <new>; CI command run and green; contracts/ledger parsed unchanged"
```

Then report, briefly:

- **The two versions**, before and after.
- **The command that proves it** — the CI invocation of the vendored engine, with
  its output.
- **That the formats still parse**, with the node counts before and after.
- **Anything you proposed and they declined**, so it is not silently lost.

If you stopped instead of updating — a fork, a stale plugin, a format that no longer
parses — lead with that and say what it will take to unblock. A repo left on an old
engine that everyone knows about is in far better shape than one carrying a fork
nobody can see.
