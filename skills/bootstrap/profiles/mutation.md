# Setting up mutation testing

Mutation testing is the only automated answer to "do these tests assert anything".
It changes the code on purpose and asks whether a test notices. A surviving mutant is
behaviour no test pins — a real gap, not a metric.

**StrykerJS** is the tool for anything JavaScript or TypeScript.

## The two thresholds, and why one number will not do

A single global threshold cannot work on a real codebase, for the same reason a
coverage percentage cannot: it averages the code you are writing now together with
the code nobody has tested since it was written.

Set **two** gates instead:

| Gate | Scope | Setting | Why |
|---|---|---|---|
| **Commit / PR** | only the source files this change touches | hard break at the target (e.g. 70%) | New code written test-first scores high. The threshold bites exactly where it should. |
| **Full suite** | everything mutable | a **ratchet** — record the baseline, forbid regression | On a codebase with untested areas the absolute number is low and cannot be fixed by a gate. What can be gated is that it never gets worse. |

Measure the full-suite baseline before choosing anything. If most mutants come back
`NoCoverage`, the ceiling is `1 − noCoverage/total`, and no threshold above that is
reachable today no matter how good the tests are.

## Scoping to the diff

A full run is tens of minutes; a scoped run is seconds. Compute changed files from
git, filter to mutable source, and pass them to `--mutate`. Skip the run entirely
when a change touches no mutable source, so docs-only commits are not taxed.

Exclude from mutation, always: generated files, vendored components, DTOs and type
declarations, DI wiring modules, migrations and seeds, and entry points. Mutating a
declaration produces mutants no test could ever kill, which drags the score down
while telling you nothing.

## Pitfalls that cost real time

**pnpm cannot resolve Stryker's plugins by name.** Stryker looks for its test-runner
plugin from the sandbox and finds nothing under pnpm's strict layout. Declare it:

```json
"plugins": ["@stryker-mutator/jest-runner"]
```

**A relative `extends` in tsconfig breaks inside the sandbox.** Stryker copies the
project to a temp directory at a different depth, so `extends: "../../tsconfig.base.json"`
resolves to nothing and every test errors in the dry run with `TS5083`. The symptom is
"Something went wrong in the initial test run" and nothing more useful.

Two fixes. `inPlace: true` skips the sandbox and avoids the problem — but it mutates
your actual working tree, so an interrupted run can leave mutated source behind.
**Never use `inPlace` in a commit hook.** The safe fix is a flattened tsconfig with no
`extends`, plus a test-runner config that points at it:

```json
// stryker.config.json
"jest": { "projectType": "custom", "configFile": "jest.stryker.config.cjs" }
```

Leave a comment in the flattened file saying it mirrors the real one and must be kept
in sync — it is a duplicate, and duplicates rot silently.

**A dry-run failure tells you almost nothing by default.** The real error is buried
several lines above the stack trace. Capture the whole run to a file and grep for the
line after `One or more tests resulted in an error`.

## Runner by toolchain

| Tests run on | Plugin |
|---|---|
| Jest | `@stryker-mutator/jest-runner` |
| Vitest | `@stryker-mutator/vitest-runner` |
| Mocha | `@stryker-mutator/mocha-runner` |
| Anything else | `@stryker-mutator/command-runner` — slowest, works everywhere |

Check the plugin supports your runner's **major** version before promising a gate.
A runner one major ahead of its Stryker plugin will fail in ways that look like
project misconfiguration.

## Reading a result

The score is the least interesting output. Go straight to the survivors, and sort each
into one of two kinds:

- **A missing test.** The mutant describes real behaviour nothing asserts. Write the
  test. This is the whole point of the exercise.
- **An equivalent mutant.** Changing it cannot be observed at this tier — a log
  message, a string the tests deliberately stub past, a constant only an integration
  test could reach. Mark it and say why:

```ts
// Stryker disable next-line StringLiteral: the strategy name is stubbed in unit
// tests, so this mutant is unkillable below the integration tier.
```

An un-reasoned `Stryker disable` is score-gaming. A reasoned one is documentation.

Never raise a threshold by disabling mutants, and never lower a threshold to make a
commit pass — lowering it is a decision about the project, not about this change, and
it belongs to the operator.
