# @cc/dsh-state-feed — L1 once, L2 by hash

One host row that puts the project state into the CONVERSATION, not into the system prompt:

- **L1** — at `agent/created` of a ROOT session whose workspace has `state/views/digest.md`, one
  user message: `digest.md`, then `state/plan.yaml` (when present), then `snapshot.md`. It is
  composed once and never edited or repeated.
- **L2** — at a turn boundary (`agent/pre-step`, `step === 1`): if the sha256 of
  `digest.md + board.md + snapshot.md` differs from the hash the session last received, one
  aggregated delta (≤ 1200 bytes) with the counts and the open-work bullets. A second change
  inside the same turn is not injected; the next turn picks the newest hash up.
- **Nothing** — a delegated worker (depth > 0, a `parentSession`, or `origin: subagent`) and a
  workspace without `state/views/digest.md` get no injection at all.

Both messages go through `agent.inject()`, which the harness writes to the journal as
`user/message` with `source.kind: "state-feed"` — so "model-visible means logged" holds without
a second mechanism. `inject` does not wake an idle driver: the text arrives at the next step
boundary of a running turn, and it is lost on `cancel` (a known property of that seam).

The plugin never writes state and never parses the projections back: `digest.md`, `board.md`
and `snapshot.md` are produced by `@cc/dsh-project-state`.

## Config

`disabled: true` loads the row and delivers nothing (one-line rollback).

## Tests

`node --test plugins/state-feed/test/*.test.mjs` — L1 once, no state, worker exclusion, L2 by
hash, aggregation within a turn, delta size cap, and the L1 composition order.
