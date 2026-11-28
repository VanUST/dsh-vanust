# @cc/dsh-project-state-panel — the Project state panel

One panel with five modes over one selection, plus an **Edit** tab in every entity drawer. It is a
LENS over files the state core already writes; it owns neither a store nor a gate, and it writes
no file itself. The owner's TWO writes go through commands: a task status goes to the taskboard
(`/taskboard owner-status`, because the board owns that row), and any field of a REQ, TASK or TEST
goes to the state core (`/state`, which checks the revision, journals `origin: human` and marks
the field as the owner's own). Nothing else in the panel writes.

| mode | reads | answers |
|---|---|---|
| Requirements | `state/views/index.json` `reqs[]`, `state/req/*.md` frontmatter | what the business asks for, its criteria, and which links are missing |
| Board | `index.json` `tasks[]` (first paint), `state/task/*.md` on a card | where the work is, which requirement each task belongs to, which tests link it, which subagents run now |
| Design map | `designmap/pages/*.excalidraw` through the `/designmap` command | the system map as an always-editable Excalidraw page: the editor fills the panel body, has a Full screen control, a readability Check and a Tidy/Render pair; every write is the designmap command, never the panel |
| Tests & trace | `index.json` `tests[]` + `reqs[]` | each test's requirement and evidence, and the REQ × TASK/TEST/DECISION matrix with its gaps |
| Plan | `state/views/plan.md`, read once when the tab opens | what the long-term plan still has open: initiatives with work left, the decisions in force, the journal's open tasks |

## The Plan mode

The Plan tab shows the generated plan, `state/views/plan.md`, which the state core writes with
`regenerateViews()` from `docs/analysis/*.json` and the journal. Nothing in the panel edits it:
a plan change means a change to an analysis record or to the board, and the view follows.

**One read, when the tab opens.** Opening Plan reads the file once; switching tabs and coming back
reuses the parsed result, and only **Reload** re-reads it. The file is parsed into three lists and
nothing else is fetched:

| block | what it draws | where the number comes from |
|---|---|---|
| Initiatives with work left | one row per initiative: title, id, stage, confirmed of total requirements | the view's initiative table, filtered to rows with an unfinished requirement or an open task; the heading carries the count the panel drew |
| Decisions | the decisions in force, newest first: id, title, initiative, status | the view's `## Решения` table |
| Open tasks | the journal's open tasks: id, title, status | the bullets under the view's open-task headings |

The panel does not repeat the view's header counts. `plan.md` states two different facts in its
header - initiatives with traced open tasks, and the journal's open tasks - and a pane that prints
one of them beside a list of the other reads as broken; the headings of the blocks the panel drew
carry the numbers it actually shows.

**Empty states.**

- No `state/views/plan.md` in the workspace: *"No generated plan in this workspace"* names the
  path and the command that writes it (`regenerateViews()` from `docs/analysis/*.json` and the
  journal), with a **Read it again** button. The same state is shown when there is no conversation
  to read the file from.
- The file exists and holds nothing: *"The plan is empty: no initiative has work left, no decision
  is recorded and no task is open."*
- The read fails (permission, transport): the alert carries the code (`plan_unreadable` or the
  gateway's own) and its message, and **Read it again** retries.

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
body and details (criteria, scope, acceptance, result); the Design map lists and opens
`designmap/pages` through the `/designmap` command. A legacy index whose rows carry no
`title` falls back to reading the entity files of exactly those rows, so an old workspace shows
its titles again instead of ids.

## Hiding chore tasks

The board subbar carries one toggle, `Hide chores (N)`, in both views (board grid and list). `N` is
the number of chore tasks in the current requirement filter, so the control says what it would hide
before it is pressed. Pressing it removes chore tasks from the list and from the board columns, and
the subbar count follows the visible rows; pressing it again brings them back. The top header keeps
the projection counts (REQ/TASK/TEST) and does not change.

It is a VIEW setting only: `state/views/index.json`, `state/task/` and `.dsh/taskboard.json` are not
written, and it is off by default, so the board looks exactly as before until the owner presses it.
If a requirement filter leaves only chore tasks, the panel says so and offers `Show chores` instead
of drawing an empty board. A chore is the task's `chore: true` in the index row or, for an older
TASK, in its frontmatter — one predicate (`isChoreTask`) answers for both.

## The contract it reads

`state/views/index.json` is the machine contract: `schemaVersion`, `lastSeq`, `counts`,
`reqs[].tasks/tests/decisions`, `tasks[].reqId/chore`, `tests[].reqId/evidenceRefs`. The panel
never parses `digest.md`, `board.md` or `traceability.md`: those are the human projections. It
reads `state/<kind>/<ID>.md` only for the fields `index.json` does not carry — title, criteria,
body, command, authorRole, revision — through the state entity format (`plugins/project-state/lib/format.mjs`).

The design map is no longer linked to requirements through `index.json` or an analysis-record
component: since design-map v2 a page is a DRAWING, and an Analysis Record may name a page in its
prose rather than point at a node. The panel therefore shows the map as its own mode and does not
invent a link between a box and a REQ; the missing link it still reports is the REQ → TASK/TEST
one from `index.json`.

## The owner's status control

**The status badge itself is the control.** There is no second plaque repeating the state: the
tone-coloured badge in the task list, on the board card and in the task drawer is a native
`<select>` wearing the chip (a CSS caret, not a second element), so clicking the status opens the
list and choosing one writes it. Native select keeps keyboard, screen-reader and touch behaviour
without a custom menu; the click stops at the badge so the row does not open the drawer. In the
drawer a small optional `why?` field travels with the next pick.

Choosing a status applies it to the panel's data FIRST (the badge is a controlled select, so the
owner sees the choice on the next paint), then sends `/taskboard {op: "owner-status", id:
<boardId>, expectedRevision, status, reason?}` — one compare-and-set against the row the panel
just read — and a refusal puts the previous value back with its code. The write also raises
`dsh:project-state-changed`, so the session-header counters re-read immediately instead of on
their five-second poll, and a reload no longer repaints the cached pre-write index over live
data. The board does the rest:
it stops the linked children for `done`/`cancelled`, mirrors the TASK, regenerates the projections
and writes a `waiver` event with code `owner_status_override` into `state/events.jsonl`.

**The panel does not re-read `index.json` after a status change.** The `owner-status` reply carries
the row the board wrote, so the panel settles that row in place — status, `revision`, `updatedAt` —
and the list is painted twice (the optimistic pick, then the settled row) instead of four times.
One status change is therefore one read of the TASK (for its `boardId`) and two commands
(`get`, then `owner-status`); measured over the workspace's 484-task projection, the read of the
221 KB `index.json` that used to follow is gone. A terminal status (`done`, `cancelled`) is the one
exception: the board has just stopped the linked children, so the panel re-reads `index.json` once
to show their new state. The change overrides the lifecycle rules on
purpose: it is the owner's door, and it is not exposed to the agent. A refusal is quoted with its
code (`stale`, `needs_revision`, `not_found`, `no_board_row`, `command_unavailable`) in the panel's
notice line, which now stays until the next status action instead of clearing itself after nine
seconds, and the same text is announced through the panel's live region (`role="status"`,
`aria-live="polite"`), which is in the first paint so a screen reader hears the refusal. A `stale`
refusal triggers one re-read so the next attempt carries the new revision. A TASK with no `boardId` cannot be changed here (`no_board_row`); without a command
transport the badge renders as the read-only chip.

A task linked through a batch (`reqIds`, no `reqId`) shows **every** requirement in the card, the
drawer, the filter and the header count; `reqId` and `reqIds` are folded by one helper
(`requirementIdsOf`), so the four views cannot disagree.

## What it does not do

- No second write of its own: the panel's own writes are the owner's status command and the
  state core's entity edit. The Design map mode mounts designmap's page editor, which writes
  the page file through the `/designmap` command (`save`, `tidy-page`, `render-page`, `lint`,
  `edit`) — the same command the agent's tools use, and the page file is its only store. The
  header badge reads `read-only · status by owner` and the source-level check refuses any
  other command call site.
- No second geometry owner: the canvas is `@cc/dsh-designmap`'s `PageEditor`; the panel gives it
  the whole body (`.ps-main-map`) and nothing else. The panel draws no node, edge or label.
- No other edit affordance in the state modes: no drag, no palette, no label editor in
  Requirements, Board or Tests & trace. The Design map mode is the exception by design — it is
  the editor, with the canvas's own drag/palette/text tools and the page editor's
  Check/Tidy/Render/Full screen controls. Gaps elsewhere are clickable to navigate to the mode
  where the link is missing; the fix happens in the owner panel or the state core.
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
the full timestamp in the cell's title. The drawer footer does the same for updated/created. The right column is visible only while a card
is open (its element stays in the DOM, hidden, so the header's `aria-controls` target resolves) — the always-on evidence rail was removed on the owner's request, so the board gets the
full width; a task's details open in the drawer and close with it.

**A task being `active` does not mean a child is working.** The task stays active until it is
accepted, while its child may be idle, finished or gone. The Board list therefore has a
**Subagents** column and each card a liveness line: `N running` with a green dot, or `N idle`.
The number comes from the same live session snapshot as the drawer, never from the task status;
a task with no recorded session shows `—`.

The frontmatter reader is the same small line parser as the state writer, extended for a list of
maps (`acceptance`, `sessions`) and for a comma inside a quoted inline item; the panel still
never parses `digest.md`, `board.md` or `traceability.md`.

## The owner's Edit mode

Every REQ, TASK and TEST drawer has an Edit tab. The form is built from the kind's schema
(`EDIT_FIELDS` in `client.js`): text and number inputs, list textareas (one item per line), a
status select, a checkbox for the chore mark, and the entity's own text as a large textarea. Only
changed fields are sent, so saving never takes ownership of a field the owner left alone.

Save runs `/state {"op":"edit","id":…,"expectedRevision":<the revision on screen>,"patch":{…}}`.
The core writes the file and the panel reads it back, so the form shows what the core wrote
rather than what the panel sent. A refusal keeps the core's code in the notice
(`revision_conflict`, `status_invalid`, `field_not_editable`), and a stale revision re-reads the
index so the next attempt is current.

A field the owner changed carries a badge (`правит человек`) and a release action on its own row.
Release sends the same command with `release:[field]`, which hands the field back: the next
mirror write sets it again. The `Owned by the core` block at the bottom of the form lists the keys
the editor will not touch — the mirror's row keys (`analysisRef`, `boardId`, `caseId`), the
revision and the derived hashes — with one sentence saying why.

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
