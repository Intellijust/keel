# Contracts

What this repo's code is agreed to do, written before (or, for backfilled
behaviour, independently of) the code that does it. The doctrine and the marker
legend live in `docs/DOCTRINE.md`.

| Marker | Meaning |
|---|---|
| `[x]` | Holds — a test proves it and has been seen to pass |
| `[ ]` | Agreed, not yet proven — the work queue |
| `[~]` | Deferred, with a reason |
| `[!]` | Known broken, with a reason |

One file per surface. The only executable surface here is the engine; the skills
are prose read by agents and are not contractable by test.
