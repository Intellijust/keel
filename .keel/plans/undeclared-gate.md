# Plan — `keel undeclared`

17 open nodes, `contracts/engine.md` § "A change no node describes".

Mode 1, measured on the first consuming repo 2026-10-02: 103 of 151 post-contract behaviour PRs
touched no contract file; 94 of those added tests.

## Shape

The engine's existing idiom: pure exported functions the tests drive directly, plus
a thin command that shells to git and wires them. `planMutation`/`verdictFor` and
`vendoredState`/`vendoredWarnings` are the precedent.

Pure and exported:

| function | answers |
|---|---|
| `parseContractText(text, file)` | extracted from `parseContract`, so nodes can be parsed from a git blob instead of disk |
| `movedNodes(before, after)` | added / removed / status-changed, keyed on `file + text` |
| `classifyChange(path, opts)` | `contract` \| `test` \| `inert` \| `excluded` \| `source` \| `other` |
| `attributeToSurface(path, surfaces)` | longest matching `root`, else the repo |
| `exemptionFrom({ flag, messages })` | `{ reason }`, or refusal when the reason is empty |
| `undeclaredVerdict(surfaces)` | per-surface pass/fail and the exit code |

Impure, in the command only: `git rev-parse --verify`, `git diff --name-only`,
`git show <ref>:<path>`, `git log <base>..HEAD --format=%B`.

## Steps, riskiest first

1. **Diff plumbing against a real git repo.** Temp repo with real commits, following
   `mutate.test.mjs`'s harness. Drives `--base <ref>`, an unresolvable ref, and git
   absent. If this is wrong every later step is built on sand, and it is the only
   part that cannot be proven with a pure function.
2. **Extract `parseContractText`.** No regex touched, no behaviour changed. The gate
   is that `keel.test.mjs`'s eight parser nodes pass unmodified.
3. **`movedNodes`.** Added, removed, re-worded (removal + addition), status change.
   The load-bearing negative: a contract file whose prose, heading, or comment
   changed while every node stayed identical moves nothing.
4. **Classification and attribution.** Test files, inert files, `exclude` paths, and
   longest-root-first surface attribution. Every skipped file is carried through to
   the report by name.
5. **Verdict and exit code.** Non-zero exactly when a surface changed source and none
   of its own nodes moved. The report counts test files changed in the same diff.
6. **Exemptions.** `--exempt "<reason>"`, a `Keel-Exempt:` trailer on any commit in
   the range, and the refusal of an empty reason.
7. **`--staged`.** Diff the index; read current contract content from the index too,
   not from disk, or a staged partial commit is judged against unstaged edits.
8. **`--json`.**
9. **Dispatch, help text, `KEEL_VERSION` → 0.4.0, `plugin.json` → 0.4.0.**
10. **Measure against a real consuming repo.** Run the finished gate over its post-contract PRs and
    record the real pass rate in the ledger. A gate whose fail rate is not known is
    not known to be adoptable (invariant 8 — a gate must be seen to fail, and seen
    to pass).

## Risks

- **`parseContract` is the format** (mental model §6). Extracting a text-parsing
  function is the one change here that could reclassify nodes in repos this code has
  never seen. Mitigation: pure extraction, zero regex edits, existing parser tests
  unmodified as the proof. If any of them needs touching, the extraction is wrong.
- **A gate nobody can pass gets switched off inside a week** (mental model §2). On
  on the first consuming repo, 68% of behaviour PRs would fail it today. Mitigation: it is diff-scoped,
  the exemption is one flag with a reason, and step 10 measures rather than assumes.
  The number is reported to the operator either way — it is not grounds for quietly
  weakening the gate.
- **`kindOf`'s INERT set becomes load-bearing for a gate**, and it was tuned on one
  stack. Mitigation: it may only ever *skip*, never fail, and every file it skips is
  named in the report.
- **`origin/main` is not every repo's base.** An unresolvable ref fails loudly rather
  than reading zero changed files as a pass. `undeclared.base` overrides.
- **Overlapping surface roots** (`apps` and `apps/web`): longest root wins. No
  surfaces configured at all falls back to one repo-wide surface, as `untested` does.
- **Exit codes are the API** (invariant 3). This is a new command, so nothing
  existing changes meaning. `doctor` is not touched.
- **Consuming repos cannot use it until they re-vendor** (`/keel:update`, its own
  commit). Expected, and the reason for the version bump.

## Rejected alternatives

**A git hook that greps the diff for `contracts/`.** Cheaper and needs no engine
change. Rejected because "a contract file changed" is satisfied by a whitespace edit,
which is the gate failing open on exactly the diligent-looking PR it exists to catch
— and because a hook each repo keeps its own copy of is the silent fork mental model
§2 warns about. When something must always happen it belongs in the engine.

**Folding it into `doctor`.** Rejected: doctor answers "is this install intact", a
question about repo state with no diff in it. Putting a per-change gate behind the
same exit code would make that code mean two unrelated things, and invariant 3 says
it is an API.
