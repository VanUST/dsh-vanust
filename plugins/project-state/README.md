# @cc/dsh-project-state — the state core (ccProjectState)

One host row that publishes the service consumers build on: the single writer of `state/` in a
workspace. It owns the entity schema, the IDs, the links with their target hash, the CAS
transitions, the journal with replay, `verify()` and `snapshot()`. It owns no model tool — the
REQ/TASK operations, the projections under `state/views/` and the migrations are their own
tasks.

## Files it writes

```
state/plan.yaml              project plan (not written by this core yet)
state/req/<ID>.md            REQ-001 …
state/decision/<ID>.md       DEC-001 …
state/task/<ID>.md           TASK-001 …
state/test/<ID>.md           TEST-001 …
state/events.jsonl           append-only journal, one JSON event per line
state/.lock                  the ID lock (a directory created with O_EXCL)
```

Each entity is git-friendly markdown: a YAML frontmatter block plus a free-text body. The
frontmatter order is fixed and the writer is deterministic, so the same entity with the same
clock produces the same bytes; the journal replay relies on that. A human edits these files in
git — a broken frontmatter is a `frontmatter_invalid` finding from `verify()`, never a silent
overwrite.

## Service API

Every method takes the workspace `cwd` first (one host row serves every workspace the UI opens)
and returns `{ ok: true, … }` or `{ ok: false, code, message }` — nothing throws into another
agent's turn.

| method | meaning |
|---|---|
| `create(cwd, kind, input)` | allocate the next typed ID under the lock and write the file; journals `create` |
| `get(cwd, id)` / `list(cwd, kind?)` | read one entity / read the index |
| `update(cwd, id, { expectedRevision, … })` | CAS: a stale revision refuses with `revision_conflict` and writes nothing |
| `complete(cwd, id, { expectedRevision })` | `update` with `status: done` |
| `link(cwd, from, to)` | append `{kind, id, hash}` where `hash` is sha256 of the target's bytes |
| `claim(cwd, id, { owner })` / `release(cwd, id)` | TASK active/open transition |
| `issueId(cwd, kind)` | the next ID WITHOUT reserving it (advisory; `create` allocates) |
| `snapshot(cwd)` | `{ relPath: sha256 }` for every state file |
| `replay(cwd)` | apply the journal in memory, re-serialize, compare bytes with disk |
| `verify(cwd)` | structured findings, read-only |

`verify()` codes: `frontmatter_invalid`, `link_broken`, `link_stale`, `req_criteria_missing`,
`task_req_missing` (unless `chore: true` with a `choreReason`), `orphan`, `status_invalid`,
`id_mismatch`, `id_duplicate`.

## Journal and replay

`state/events.jsonl` is append-only: each event carries `seq`, `at`, `op`, the entity id/kind,
the revision and the full record plus body. `replay()` rebuilds the expected text from the
events and compares it with the files, so a hand edit that the journal never saw shows up as a
`bytes_differ` mismatch instead of being silently accepted. The journal is an audit trail, not
the source of truth: the files are.

## Projections (`state/views/`)

`regenerateViews()` renders the projections from the entities and writes them under
`state/views/`; it never touches `state/req|decision|task|test/` or the journal.

| file | content |
|---|---|
| `index.json` | the MACHINE contract for the panel: `schemaVersion`, `lastSeq`, counts, every REQ with its `tasks`/`tests`/`decisions`, every TASK with `reqId`, every TEST with `reqId` and `evidenceRefs` — stable ids, no prose |
| `digest.md` | the small L1 block, hard-capped at 3072 bytes; truncated deterministically with a marker |
| `board.md` | TASK grouped by status in a fixed order |
| `traceability.md` | REQ → tasks/tests/decisions, and each TEST with its evidence |
| `map/REQ-*.mmd` | one mermaid subgraph per REQ |
| `snapshot.md` | counts, tasks by status and the last journal sequence |
| `.hashes.json` | sha256 of every file above; `verify()` compares it and reports `view_modified` |

Every list is sorted by id, the section order is fixed and no wall clock appears, so a second
run on unchanged state is byte-identical. The projections carry `GENERATED — DO NOT EDIT`; a
hand edit is not accepted — `verify()` names it (`view_modified`, path `views/<file>`) and
`regenerateViews()` overwrites it.

## Lock

IDs are allocated under `state/.lock` (a directory created with `O_EXCL`), so two agents asking
for the next TASK at the same moment cannot get the same number. A lock older than
`lockStaleMs` (10 s default) is removed with a warning rather than blocking the workspace.

## Config

`stateDir` (default `state`), `lockTimeoutMs` (3 s), `lockStaleMs` (10 s). The row injects
nothing: it only provides the service.

## Tests

`node --test plugins/project-state/test/*.test.mjs` — parallel ID allocation (20 creates), byte
determinism, link hash staleness, CAS refusal with untouched file, journal replay, every
`verify()` code, and the service publication on a fake host context.
