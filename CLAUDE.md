# Keel — working conventions

@MENTAL_MODEL.md

The harness, applied to itself. Any change to observable behaviour starts in
`contracts/`, not in a source file; the arc is `/keel:change → plan → tdd →
verify → review`, and gates passed are recorded in `.keel/ledger.md`.

Two things are different about working *on* Keel rather than *with* it:

- **You are editing the instrument, not the specimen.** A defect here does not
  break this repo — it silently passes bad work in every consuming repo. Treat a
  change to `scripts/keel.mjs` with the care its blast radius deserves, and read
  `docs/DECISIONS.md` before proposing a design change: the obvious
  simplification has usually been argued already.
- **Consuming repos vendor the engine.** The plugin's `scripts/keel.mjs` is the
  source of truth; a fix that lands here is invisible to a consuming repo until
  someone re-vendors its `.keel/keel.mjs` — which is `/keel:update`, in its own
  commit, once the plugin there has been updated. Bump `KEEL_VERSION` and
  `.claude-plugin/plugin.json` together; `doctor` warns when they drift.

## Commands

Verified in `.keel/config.json`. The repo is deliberately dependency-free — no
package.json, nothing to install:

```bash
node --check scripts/keel.mjs              # syntax (no linter, by design)
node --test "scripts/**/*.test.mjs"        # the engine's own tests
node scripts/keel.mjs contracts --open     # the work queue
node scripts/keel.mjs doctor               # run against a consuming repo, not here
```

`doctor`, `probe`, `untested` and friends are written to run *inside a consuming
repo*; from this repo they inspect Keel itself, which is occasionally what you
want and usually not.

## Testing conventions

- Engine tests live beside the engine: `scripts/*.test.mjs`, Node's built-in
  runner, no dependencies.
- The engine's behaviour that matters most is its **exit codes and its parsing**
  — skills and CI branch on the former, every consuming repo's `contracts/`
  depends on the latter.
- The skills (`skills/*/SKILL.md`) are prose read by agents. They are not
  testable here; changes to them are reviewed by reading, and proven by running
  the arc against a real consuming repo.
