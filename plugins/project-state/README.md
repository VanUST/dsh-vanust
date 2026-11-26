# @cc/dsh-project-state — the state core (ccProjectState)

One host row that publishes the service consumers build on: the single writer of `state/` in a
workspace. It owns the entity schema, the IDs, the links with their target hash, the CAS
transitions, the journal with replay, `verify()` and `snapshot()`. It owns no model tool — the
REQ/TASK operations, the projections under `state/views/` and the migrations are their own
tasks — and it registers ONE command, `/state`, which is how the owner's own hand edit reaches
the core from the State panel.

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

## The TASK record

A TASK is not only a title and a body. It carries the concrete task the Tasks panel edits, so
the register and the board cannot disagree about what one acceptance unit covers:

| field | shape | meaning |
|---|---|---|
| `title`, `status` | scalar | the board's title and lifecycle status |
| `scope` / `nonScope` | list of strings | what the task touches / what it must not touch |
| `acceptance` | list of `{text, done}` | the criteria the result is judged by; a bare string is an open criterion |
| `steps` / `stepsDone` | list / number | the plan and its progress; `stepsDone` is dropped when `steps` is cleared |
| `role`, `preset`, `inline` | scalar / bool | the assignment: a specialist role or inline work, never both |
| `owner` | `{kind, label, sessionId?}` | who took it; `sessionId` names the linked child |
| `sessions` | list of `{sessionId, label, role, status}` | the child sessions that serve the task; the State panel opens one by this id. `status` is what was recorded at write time — LIVE running/idle is not stored here, because it belongs to the runtime (the panel and `task_list` read it from the session/agents service) |
| `resultSummary`, `resultEvidence`, `resultArtifacts` | string / lists | the accepted result |
| `body` | text | the objective, exactly what the Tasks panel calls `objective` |

Every field is optional and ADDITIVE: a TASK written before the field existed stays valid, and
`verify()` reports no new finding for it. `update()` CLEARS a field when the patch carries an
empty list or an empty string, so removing a scope line in the panel removes it here too. A
schema backfill passes `preserveUpdatedAt: true` to keep the file's own last-change time (the
panels order by it); it is a control flag and is never stored.

## The owner's hand edit (`manualFields`)

The register is written by mirrors (the analysis record, the taskboard, the case library), but
the owner can edit an entity by hand from the State panel: the `/state` command in this row turns
`{"op":"edit","id":"REQ-001","expectedRevision":3,"patch":{…},"release":["title"]}` into
`update(cwd, id, {…, origin: "human"})`. A write is accepted only if the payload carries the
revision of the file the panel read, so a mirror write between the read and the save is refused
with `revision_conflict` instead of being overwritten.

**What a hand edit may touch** is `HUMAN_EDITABLE` in `lib/core.mjs`, per kind:

| kind | editable fields |
|---|---|
| REQ | `title`, `status`, `body`, `criteria`, `source`, `reason` |
| TASK | `title`, `status`, `body`, `reqId`, `reqIds`, `scope`, `nonScope`, `acceptance`, `steps`, `stepsDone`, `role`, `preset`, `inline`, `ownerRole`, `reason`, `chore`, `choreReason`, `resultSummary`, `resultEvidence`, `resultArtifacts` |
| TEST | `title`, `status`, `body`, `reqId`, `authorRole`, `command`, `testPath`, `evidenceRefs` |
| DECISION | `title`, `status`, `body`, `reason`, `supersededBy` |

Anything else is refused whole with `field_not_editable` and nothing is written. The rest of the
frontmatter is either the mirror's row key (`analysisRef`, `boardId`, `caseId`), the workflow
position (`revision`, `createdAt`, `updatedAt`), a value derived from other fields
(`criteriaHash`, `frozenHash`) or a relation (`links`, `sessions`, `owner`); editing one from a
text box would duplicate a mirrored row or leave a hash claiming something the record no longer
says.

**A hand-edited field is the owner's until it is released.** The entity records
`manualFields` (sorted field names, `body` included) and `manualAt`; the journal event carries
`origin: human`. A later AUTOMATIC write — a mirror, or any tool call that does not pass
`origin: "human"` — puts the stored value back for every masked field, and a write that would
change nothing else is not written at all, so the revision does not churn on every mirror pass.
`{release: ["title"]}` (a hand edit) hands the field back: the next automatic write sets it
again. A masked `steps` also freezes `stepsDone`, because a plan and its progress are one value.

The owner's status edit wins over the mirror in the same way. The board still owns its own row,
so a TASK whose status was taken by hand can disagree with the board until the owner releases it;
the panel shows which fields are theirs, with a release action on the row.

## Service API

Every method takes the workspace `cwd` first (one host row serves every workspace the UI opens)
and returns `{ ok: true, … }` or `{ ok: false, code, message }` — nothing throws into another
agent's turn.

| method | meaning |
|---|---|
| `create(cwd, kind, input)` | allocate the next typed ID under the lock and write the file; journals `create` |
| `get(cwd, id)` / `list(cwd, kind?)` | read one entity / read the index |
| `update(cwd, id, { expectedRevision, … })` | CAS: a stale revision refuses with `revision_conflict` and writes nothing. `origin: "human"` marks the written fields as the owner's (`manualFields`), and an automatic write skips those fields; `release: [field]` hands them back |
| `complete(cwd, id, { expectedRevision })` | `update` with `status: done` |
| `link(cwd, from, to)` | append `{kind, id, hash}` where `hash` is sha256 of the target's bytes |
| `claim(cwd, id, { owner })` / `release(cwd, id)` | TASK active/open transition |
| `journal(cwd, event)` | append one `waiver` event to `state/events.jsonl` (the one audit path a consumer outside this plugin may use); `replay()` skips it |
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
| `index.json` | the MACHINE contract for the panel and its FIRST-PAINT read model: `schemaVersion`, `lastSeq`, counts; every REQ with `title`, `updatedAt` and its `tasks`/`tests`/`decisions`; every TASK with `title`, `reqId`/`reqIds`, status, `steps`/`stepsDone`, `role`/`preset`/`inline`/`owner`, `sessions` and `updatedAt`; every TEST with `title`, `reqId`, `authorRole`, `command`, `updatedAt` and `evidenceRefs` — stable ids and list fields only, never the body. The file is COMPACT JSON (one line), because the gateway caps a read at 5000 lines and the panel's first paint must stay one read; human projections are `board.md`/`digest.md`. The drawer's details (criteria, scope, acceptance, result, body) come from the entity file on open. A row without `title` is treated as a legacy index and its file is read for the title |
| `digest.md` | the small L1 block, hard-capped at 3072 bytes; truncated deterministically with a marker |
| `board.md` | TASK grouped by status in a fixed order |
| `traceability.md` | REQ → tasks/tests/decisions, and each TEST with its evidence |
| `map/REQ-*.mmd` | one mermaid subgraph per REQ |
| `snapshot.md` | counts, the agents the ledger records as working (`active agents`), tasks by status and the last journal sequence |
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
`verify()` code, the concrete TASK fields (including the clearing update), an inline list item
with a comma and quotes, and the service publication on a fake host context.
