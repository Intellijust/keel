# Choosing a test runner

The runner is a long-lived dependency and the operator's decision. Your job is to
give them the obvious choice, the reason, and the cost — not to pick for them.

The strongest argument is almost always **the toolchain the project already uses**. A
runner that shares the build's transform, path aliases, and TypeScript config
resolves imports the same way the application does; one that does not will produce
failures that teach nothing about the code.

## Reasonable defaults by toolchain

| Project builds with | Runner | Why |
|---|---|---|
| Vite (React, Vue, Svelte) | **Vitest** | Reuses `vite.config.ts` — same aliases, same transform, no second build pipeline to keep in sync. Jest-compatible API, so existing knowledge transfers. |
| Next.js | **Vitest** or **Jest** | Both are supported paths; follow whichever the team already knows. |
| NestJS | **Jest** | What `@nestjs/cli` scaffolds and what its testing utilities assume. Do not migrate a working Nest suite to something else as part of a bootstrap. |
| Plain Node / a library | **node:test** | In the standard library. No dependency, no config, adequate for anything that does not need a DOM. |
| Anything, for browser journeys | **Playwright** | Real browsers, good tracing, parallel by default. |

For React component tests, add **@testing-library/react** and a DOM environment
(`jsdom`, or `happy-dom` when startup time matters). Testing Library is the right
default because its query API pushes tests toward what a user can observe — the same
principle as invariant 5, enforced by the tool.

## Rules

**Never introduce a second unit runner on one surface.** Two runners means two
configs, two sets of globals, and a suite nobody can run in one command.

**Match the existing config, do not invent one.** Same package manager. Same
`tsconfig` paths. Same module resolution. If the project builds with a path alias,
the runner must resolve it too.

**Prove it with one real test, then break the implementation.** A runner that has
only ever seen green has not been shown to work. This is the same rule as witnessing
RED, applied to the tooling.

**Put it in CI in the same pass.** A runner that exists only on one machine is not a
gate, and the next contributor will not know it was meant to be one.

**Measure and report startup cost.** A DOM environment adds real time per file. The
operator needs that number to decide what belongs in a pre-commit hook.
