# @cc/dsh-state-feed — L1 once, L2 by hash

One host row that puts the project state into the CONVERSATION, not into the system prompt:

- **L1** — at `agent/created` of a ROOT session whose workspace has `state/views/digest.md`, one
  user message: `digest.md`, then the open tasks, then `state/plan.yaml` (when present), then
  `snapshot.md`. It is composed once and never edited or repeated.
- **L2** — at a turn boundary (`agent/pre-step`, `step === 1`): if the sha256 of
  `digest.md + board.md + snapshot.md` differs from the hash the session last received, one
  aggregated delta (≤ 1200 bytes) with the counts, the open-work bullets and the open tasks. A
  second change inside the same turn is not injected; the next turn picks the newest hash up.
- **Open tasks** — both messages carry one counter line with the three figures the owner named:
  `unclosed` (every task not done and not cancelled, blocked included), `active` (status
  `active`) and `agents` (the sessions the ledger records as still working, from the snapshot's
  own `active agents` line — the ledger's record, not a live probe). Below it, the titles of the
  open tasks with their status, parsed from the `board.md` table: at most twelve titles, then a
  `+N more` line; a board with no open task says `no open tasks` instead of leaving the heading
  alone. Done and cancelled tasks are not listed.
- **Nothing** — a delegated worker (depth > 0, a `parentSession`, or `origin: subagent`) and a
  workspace without `state/views/digest.md` get no injection at all.

L1 goes through `agent.inject()` at `agent/created` (not a step boundary). L2 does not: the
harness claims a step's batch before it runs the `agent/pre-step` waterfall
(`dsh-agent-loop/lib/index.js:683` then `:698`), and `inject()` queues for the *next* step
without waking the driver (`:585-587`) — so a delta injected from inside the hook could never
join the turn boundary that asked for it and stayed pending when that turn had no further step.
The delta therefore enters the step through the waterfall decision, the same seam the harness's
own `agent-instructions` participant uses (`lib/index.js:1480-1497`), and the loop appends it
to the journal as `user/message` with `source.kind: "state-feed"`
(`dsh-agent-loop/lib/index.js:873-878`) — "model-visible means logged" still holds without a
second mechanism.

The plugin never writes state and never parses the projections back: `digest.md`, `board.md`
and `snapshot.md` are produced by `@cc/dsh-project-state`.

## Config

`disabled: true` loads the row and delivers nothing (one-line rollback).

## Tests

`node --test plugins/state-feed/test/*.test.mjs` — L1 once, no state, worker exclusion, the
delta entering the step decision with no session write in the hook, L2 by hash, aggregation
within a turn, delta size cap with no dangling section header, and the L1 composition order.
