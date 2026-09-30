# Reasoning: a ratchet child is re-attached across a process restart, not replaced

Status: source for a proposed decision. Written 2026-09-30 after a defect report on the
`Unnamed` project.

## What was observed

Session `session-0c592326-25db-408c-b0be-28655e5c63c2` (project
`/home/iustimov/tasks/Unnamed`) held **four** subagent children of the ratchet's two
roles — two `ratchet-judge` and two `resolve-verify` — all parented to that one session
under one law set.

| local time | event |
| --- | --- |
| 13:08:47 | `resolve-verify` #1 `ddb42dd4` (panel auto-dispatch; ledger `ratchet.resolve.dispatched` at 13:08:47.868Z with key `red-gate:verify`) |
| 13:16:36 | `ratchet-judge` #1 `e1325df7` (`ratchet_review`) |
| 14:03:37 | turn 4 interrupted |
| 14:04:35 | `dsh web` process restarted (measured with `ps -o lstart`) |
| 14:05:27 | `session/end-seed`; a "continue" message starts turn 5 |
| 14:29:42 | `resolve-verify` #2 `01950f64` — same finding, same project root |
| 14:39:32 | `ratchet-judge` #2 `bf5a3f48` — same role, same parent session |

The duplicate pair spent another 1,425,081 prompt tokens (resolver) and 78,638 (judge) on
top of the first pair's 2,364,162 and 131,167.

## What causes it

Both roles hold their child id only in process memory:

- `createJudgePool` keeps `entries = new WeakMap()` keyed on the **parent Agent object**
  (`plugins/ratchet/ratchet-judge.mjs:265`). A restart builds a new Agent for the session,
  so the entry is absent and `runCall` takes the `entry.childId === null` branch into
  `create` (`:471-480`).
- `resolverFor` keeps a `Map` per plugin activation (`plugins/dsh-adr-panel/index.js:639`).
  The next auto-dispatch finds no remembered child and calls `startContinuable`.

The child sessions are not lost: they are durable, and the harness already supports
re-attaching to them. `sendMessage(parent, childId, …)` routes through `deliverToChild`
→ `deliverFollowup`, which cold-resumes a child with no live activation
(`@deepseek-ai/dsh-subagent/lib/index.js:1734`, `:1796`, `:1870-1901`): it reads the child's
durable log (`observeSession`), requires its folded descriptor to be `mode: continuable`,
verifies the child's header names the sending parent, and re-materializes the agent. Both
children in the observed session are `continuable` and name `session-0c592326` as their
parent, so every condition is met.

What is missing is only the **remembered id** across a restart. The harness already
persists it in a place the ratchet can read: the parent session's own durable log holds a
`subagent/catalog` record for every continuable child it created —
`{ version, childId, childCreatedAt, mode, label }`, written by `establishCatalogChild`
(`@deepseek-ai/dsh-subagent/lib/index.js:1509-1523`) — and `Session.snapshotEvents()`
(`@deepseek-ai/dsh-session/lib/types/index.d.ts:187`) is a public read of that log.

For the resolver the durable memory already exists too: the project ledger records
`ratchet.resolve.dispatched` in `.dsh/ratchet/ledger.jsonl`; it simply does not carry the
child id it started.

## Why the law did not catch it

`shipped-plugins.a-judge-is-reused-across-corpus-changes` states that one judge child
serves every review a session's root agent runs, and that only a failed delivery or a
changed judge role replaces it. Two judges existed for one session under one law set, and
neither replacement was a failed delivery or a role change — so the statement was false in
the observed session while its check, `node --test scripts/test-ratchet.mjs`, passed. The
check drives the reuse path inside ONE pool instance, so it measures reuse across a corpus
change and never across a restart. A check that cannot see the failure is not enforcement
of the statement.

## The decision

1. **The judge pool re-discovers its child from the parent session's own catalog.** On an
   entry with no child id, the pool folds `subagent/catalog` events for its label and, when
   one names a `continuable` child, adopts it and delivers the full task with the existing
   supersede note (the static prefix of the old child is unknown, and re-sending the whole
   task is already how a corpus change is handled). Only a delivery that the runtime refuses
   — `NOT_RESUMABLE`, `UNAUTHORIZED` — replaces the child, which is exactly the replacement
   the existing law already allows.
2. **The resolver child id is recorded in the ratchet's ledger, and read back before a
   start.** A new `ratchet.resolve.child` event is appended whenever a resolver child is
   started, by the click path and by the automatic path alike; the service exposes the
   remembered id, and the panel's registry uses it when its in-memory map is empty. A
   refused steer falls back to starting a fresh child, as it already did.
3. **The statements become checks.** Two proposed laws carry the behaviour, each with a
   hermetic command check that fails when the memory is dropped.

## Alternatives rejected

- **A new state file under `$DSH_HOME` keyed by session id.** It would duplicate a fact the
  session log already holds durably, add a second thing to keep in sync after a crash, and
  make the judge's identity depend on a file the harness does not own. Reading the
  session's own catalog is the same information with one fewer writer.
- **Keying the judge pool on `parent.id` instead of the Agent object.** That survives a
  resumed Agent within one process, but not a restart, and the observed defect is a
  restart. It would also leave a `Map` that grows with every session the process serves,
  where the `WeakMap` collects.
- **A new state file per project holding both child ids.** It works, but the resolver id is
  already a fact of the project ledger and the judge id is already a fact of the session
  log; a third copy is one more place to be wrong.
- **Never replacing a child.** The law allows replacement after a failed delivery because a
  child that cannot be resumed must not wedge every later review. The re-attach must be
  attempted before a create, not instead of one.
- **Making the judge a one-shot child.** It would remove the id that must be remembered at
  the cost of paying the orientation prompt on every review, which is the defect ADR 0085
  was written to remove.
