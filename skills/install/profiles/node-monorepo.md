# Profile — Node monorepo (pnpm/npm/yarn workspaces, Nx or Turbo)

## Surfaces

One surface per app or package that has its own tests. `apps/*` and `packages/*`
each get their own contract file. Do not merge them: they have different consumers,
different test runners, and different failure modes.

## Commands

Prefer the workspace-filtered form over `cd`-ing, so commands are copy-pasteable
from any directory:

- pnpm: `pnpm --filter <pkg> exec jest`
- npm: `npm run test --workspace <pkg>`
- yarn: `yarn workspace <pkg> test`

With Nx present, `nx affected -t test` is the right `testChanged` — it uses the
project graph rather than a file heuristic. Confirm the base ref it compares
against (`--base=origin/main`) or it will silently test nothing on a clean tree.

Take `lint` from CI verbatim. A local `lint` script that includes `--fix` is the
wrong command for verification: it rewrites files instead of reporting, so it can
turn a real failure into a silent edit. Use the non-writing invocation.

## Test runner notes

- **Jest**: scope with `-t "<name>"` for a single test, or pass the file path.
  `--runInBand` matches most CI configs and avoids worker flake on small suites.
- **Vitest**: `vitest run <path>` — the bare `vitest` watches, which will hang an
  agent's tool call.
- Check for a `jest`/`vitest` block in `package.json` before assuming a config file
  exists; `rootDir` and `testRegex` there determine which files even count as tests.

## Hooks worth considering

Only if measured fast: lint-on-changed-files after an edit. Most monorepo full
suites and all builds are too slow to hook — leave those to `/keel:verify` and CI.

A `husky` + `lint-staged` setup already covers formatting at commit time; do not
duplicate it with a hook.
