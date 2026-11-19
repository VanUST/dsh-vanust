# @cc/dsh-project-state-panel — the Project state panel

One panel with four modes over one selection. It is a LENS over files the state core already
writes; it owns neither a store nor a gate. Its ONE write is the owner's own change of a task
status: the panel asks the taskboard (which owns the row) through the `/taskboard` command, the
board mirrors the row into `state/task/` and records the override in the state journal. The
panel writes no file itself.

| mode | reads | answers |
|---|---|---|
| Requirements | `state/views/index.json` `reqs[]`, `state/req/*.md` frontmatter | what the business asks for, its criteria, and which links are missing |
| Board | `index.json` `tasks[]` (first paint), `state/task/*.md` on a card | where the work is, which requirement each task belongs to, which tests link it, which subagents run now |
| Design map | designmap's read-only `views` command | the system map, drawn by the same React Flow renderer as the Design map panel |
| Tests & trace | `index.json` `tests[]` + `reqs[]` | each test's requirement and evidence, and the REQ × TASK/TEST/DECISION matrix with its gaps |

## Decisions are not a second register

The panel shows **no** DEC badges, no Decisions column and no `no decision` gaps. A DECISION
entity exists in the state core (an ADR-style record with a rationale and a named successor),
but nothing writes it in this workflow: the decisions that explain a feature already live in
`docs/analysis/<initiative>.json` as `decisions[]` (decision, rationale, alternatives), which is
the durable record. Duplicating them as per-requirement DEC rows added noise without a link
rule, so the panel does not promote the kind; the core keeps it for compatibility.

## Loading

The first paint reads **`state/views/index.json` only** and draws the requirements, the board,
the list and the test tables from its rows. The read asks for the gateway's maximum 5 000-line page; the index is compact JSON (one line),
so it arrives in **one** round trip (it used to be three at a 2 000-line page cap, and before
the index rewrite one read per entity, ~430). Every later open paints the last index
of the session from `sessionStorage` at once and replaces it with the fresh one
(stale-while-revalidate): a cold open costs one read, a warm open costs none before the paint.
The 5-second header counter uses the same one-page read. Opening a card fetches that one entity file for the drawer's
body and details (criteria, scope, acceptance, result); the Design map fetches
`docs/analysis/*.json` the first time that mode opens. A legacy index whose rows carry no
`title` falls back to reading the entity files of exactly those rows, so an old workspace shows
its titles again instead of ids.

## The contract it reads

`state/views/index.json` is the machine contract: `schemaVersion`, `lastSeq`, `counts`,
`reqs[].tasks/tests/decisions`, `tasks[].reqId/chore`, `tests[].reqId/evidenceRefs`. The panel
never parses `digest.md`, `board.md` or `traceability.md`: those are the human projections. It
reads `state/<kind>/<ID>.md` only for the fields `index.json` does not carry — title, criteria,
body, command, authorRole, revision — through the state entity format (`plugins/project-state/lib/format.mjs`).

The map-to-requirement link is not in `index.json`. The panel takes it from the analysis record
(`docs/analysis/*.json`): REQ `analysisRef` (initiative + requirementId) → `trace[]` row →
`componentId` → the scene node whose id is that component or ends with `.<component>`. This is
the one input beyond `state/`; it is read-only. When no component matches, the node drawer says
so, and the missing link is reported as a gap rather than a zero.

## The owner's status control

A board card and the task drawer carry a status control. Choosing a status sends
`/taskboard {op: "owner-status", id: <boardId>, expectedRevision, status, reason?}` — one
compare-and-set against the row the panel just read — and the board does the rest: it stops the
linked children for `done`/`cancelled`, mirrors the TASK, regenerates the projections and writes a
`waiver` event with code `owner_status_override` into `state/events.jsonl`. Then the panel re-reads
`index.json` and paints the new status. The change overrides the lifecycle rules on purpose: it is
the owner's door, and it is not exposed to the agent. A refusal is quoted with its code
(`stale`, `needs_revision`, `not_found`, `no_board_row`, `command_unavailable`) in the panel's
notice line, and a `stale` refusal triggers one re-read so the next attempt carries the new
revision. A TASK with no `boardId` cannot be changed here (`no_board_row`).

A task linked through a batch (`reqIds`, no `reqId`) shows **every** requirement in the card, the
drawer, the filter and the header count; `reqId` and `reqIds` are folded by one helper
(`requirementIdsOf`), so the four views cannot disagree.

## What it does not do

- No second write: besides the owner's status command, the panel executes only designmap's
  `views` op, which renders in memory (`write:false`). The header badge reads
  `read-only · status by owner` and the source-level check refuses any other command call site.
- No second geometry owner: the map is `@cc/dsh-designmap`'s `SceneCanvas`, whose node
  positions, edge points and label plates come from the rendered scene. The panel's only
  overlay is its requirement badge, positioned from those scene coordinates.
- No other edit affordance: no drag, no palette, no label editor, no create/close/run button.
  Gaps are clickable to navigate to the mode where the link is missing; the fix happens in the
  owner panel or the state core.
- No stale banner for links: `index.json` v1 carries no stale flag, so the panel does not
  invent one; `verify()` in the state core is the authority.
- No History tab: v1 shows `revision`, `createdAt` and `updatedAt` from the entity frontmatter.
  A journal-backed history is a later decision.

## The task card and session navigation

Opening a TASK in Board shows the concrete task the entity carries: role/owner, steps with
progress, `scope`, `nonScope`, `acceptance` with its done marks, the linked sessions and the
accepted result, then the body under **Objective**. A TASK written before those fields existed
says `not recorded` instead of drawing an empty section — the panel never invents a value.

**Steps are a plan and a counter, not a progress bar derived from work.** `steps` is the ordered
list the task was created with (or edited to); `stepsDone` is an integer the task's owner writes
with `task_update` (the Tasks panel and the agent both go through it). Nothing advances it
automatically — a child finishing a command, a file changing or a test passing does not move the
number. The card prints `N of M done` and lists the plan with the first N steps marked done; the
note beside the list says where the counter comes from, so a stuck `0 of 4` reads as "nobody
updated it", not as "no work happened". To track a task, update `stepsDone` at each step
boundary; the register mirrors the same list and counter into `state/task/`.

**Subagents** lists the sessions the TASK recorded (`sessions` in the frontmatter, written by
the taskboard mirror from the one-child-one-task lease). Each row carries the live status:
`running` comes from the session snapshot, otherwise the status recorded at write time. The
**Open** button calls `uiWorkspace.openSession(sessionId)`, the shell's navigation service — a
service that also serves a sleeping child's transcript. It is navigation, not a write: it sends
no command and touches neither `state/` nor `.dsh/taskboard.json`. A shell without that service
keeps the row and says `Open unavailable`.

**The list carries the assignment.** Columns: Status, Task, **Role** (role + preset, or
`inline`), Requirement, Progress, Subagents, Updated — and Updated reads as elapsed time
(`сейчас`, `5 мин назад`, `2 ч назад`, `3 дн назад`; older than a month drops to a date), with
the full timestamp in the cell's title. The drawer footer does the same for updated/created. The right column exists only while a card
is open — the always-on evidence rail was removed on the owner's request, so the board gets the
full width; a task's details open in the drawer and close with it.

**A task being `active` does not mean a child is working.** The task stays active until it is
accepted, while its child may be idle, finished or gone. The Board list therefore has a
**Subagents** column and each card a liveness line: `N running` with a green dot, or `N idle`.
The number comes from the same live session snapshot as the drawer, never from the task status;
a task with no recorded session shows `—`.

The frontmatter reader is the same small line parser as the state writer, extended for a list of
maps (`acceptance`, `sessions`) and for a comma inside a quoted inline item; the panel still
never parses `digest.md`, `board.md` or `traceability.md`.

## Cross-selection

Selecting a requirement filters Board, Tests and the map highlight. From a task the drawer
shows its requirement and tests; from a test it shows its requirement and evidence references;
from a map node it shows the requirements traced to that component, and following one switches
to Requirements with the filter set. From a task, **Open** switches to the subagent's
conversation. The drawer is one component for every entity, with Overview and Links; Escape
closes it and focus returns to the opener.

## Registration

The package declares `dsh.client` with `external: ["@cc/dsh-designmap"]`, so the loader
materializes designmap's exports before this bundle and the map renderer is the installed one.
The host half is an empty row: the panel has no tool, no service and no prompt section.
