# @cc/dsh-taskboard

The task-centered dashboard that replaces the subagent catalog as the place work
is tracked.

## What it stores

One JSON ledger per session workspace, `.dsh/taskboard.json`:

- `id`, `revision`, `title`, `objective`, `chatId`
- `scope[]`, `nonScope[]`, `acceptance[{text,done}]`
- `status` — open, active, paused, review, done, blocked, cancelled
- `priority`, `owner`, `reason` (why a task is blocked), `parentId`, `parentSessionId`,
  `dependsOn[]`, `childSessionIds[]`,
  `children[{sessionId,label,role,status,startedAt,endedAt,stopReason}]`
- `role` + `preset` on a task, or `inline: true`; `agents[{role,label,sessionId,preset,status,taskCount,lastTaskId}]` for the persistent specialist roster
- `result { summary, evidence[], artifacts[], decisions[], risks[] }`
- `timeline[{at, kind, actor, text, sessionId?}]`

The `preset` on a roster row is the tool composition its child was started with. The
delegator reuses a role's session only when the requested preset matches it: a session keeps
the composition it was created with, so an old row (before the role presets, or under a
different one) is re-created rather than handed a brief its tools cannot perform.

## The lifecycle

Seven states, and no two of them mean the same thing:

| state | means | reached by |
| --- | --- | --- |
| `open` | created, nobody is working on it | `task_create` (it is the default) |
| `active` | a specialist child or the owner is working | `task_update`, `task_link`, `task_resume` |
| `paused` | held; linked children interrupted | `task_pause` |
| `review` | work claimed finished, waits for acceptance | `task_update` (with a result and evidence) or the child settling |
| `done` | accepted | `task_close`, only from `review` |
| `blocked` | cannot proceed, and says why | `task_update` with a `reason` |
| `cancelled` | terminal, not reachable from `done` | `task_cancel` (interrupts the children), or `task_update` for a childless task that is not paused |

`proposed` and `ready` were two names for "not started". They are not states any more: a row
that still says them is **display-mapped to `open` on read** and its bytes are left alone, so
the ledger format version stays 1 and no old row is rewritten by a read.

The transitions are enforced by the Host, in `transitionRefusal()`, because the model tools
and the human's panel reach the same service. Every refusal is a value with a named code:

| code | when |
| --- | --- |
| `needs_role_or_inline` | `open -> active` for a task with no role+owner and no `inline: true`; also `task_create` with neither |
| `needs_result` | `-> review` without a result summary |
| `needs_evidence` | `-> review` without one evidence item |
| `needs_reason` | `-> blocked` without a reason, and a BLANK reason on an already-blocked task |
| `use_pause` | `paused` set through an ordinary update |
| `use_close` | `done` set through an ordinary update, or a cancel of a task with linked children |
| `use_resume` | any move out of `paused` through an ordinary update |
| `needs_review` | `task_close` on a task that is not in review |
| `needs_result` | also `task_close` on a task whose result has no summary — the child settling is not an acceptance |
| `initial_status` | `task_create` with any status other than `open` (or `blocked` with its reason); a task is born open |
| `needs_revision` | a command-path write without the `expectedRevision` it read |
| `terminal` | any move out of `done` or `cancelled` |
| `other_chat` | a write from another chat's agent |

**A task is born open.** `task_create` refuses `done`, `cancelled`, `paused`, `active` and
`review` with `initial_status`, so `done` cannot be minted without an acceptance; `blocked` is
a real starting state and needs its reason.

**`task_cancel` is the door the transition table does not have.** An ordinary update refuses a
move out of `paused` (`use_resume`) and a cancel of a task that still has children (`use_close`),
which left a paused task and a delegated task impossible to abandon. `task_cancel` interrupts the
linked children (fail closed, like `task_pause`), writes `cancelled`, records the reason as a
decision on the result and as a timeline entry, and never rewrites a summary somebody wrote.
`done` is not cancellable: an accepted task stays accepted.

**`task_close` needs a result.** A linked child settling still moves its task to `review` — that
is the runtime reporting that work finished — but closing refuses with `needs_result` until
somebody wrote the summary. "The child finished" is a signal; the acceptance is a judgement.

**The command registry is the human/client path; agents use the tools.** `delegate_task` and
the model tools carry `expectedRevision` in their schema. The `/taskboard` command has only what
the panel sends, so it checks it itself: every mutating op (`update`, `note`, `link`, `pause`,
`resume`, `close`, `cancel`, `remove`) is refused with `needs_revision` when the revision is
missing and with `stale` when it moved. A create is the one exception — there is nothing to
compare yet.

**The assignment is editable, and it is one field pair.** `task_update` accepts `role`,
`inline` and `owner` (the panel shows them beside the status), so a row written before the role
rule can be adopted instead of left unassigned: a role with an owner, or inline work. The
`open -> active` check reads the same patch, so both can arrive in one write; a task never
carries a role and `inline: true` at once, and `owner: null` clears the owner.

**No task is role-less.** A task either carries a `role` (and the `preset` its child runs
with) or it is `inline: true`: work the owner — the orchestrator or the human — does itself,
with no specialist child. `task_create` refuses the third case with
`needs_role_or_inline`; a delegated task's role is its owner until `task_link` replaces it
with the child session, which is what `open -> active` checks. A pre-rule row with neither is
labelled `unassigned` in the panel instead of being refused on read or rewritten.

**A chat has its own board.** `chatId` is the root session of the lineage that created
the task, so a delegated child's rows land on the parent chat's board instead of its own.
Reads default to the caller's chat; the whole workspace history is still one explicit
request away (`task_list` with scope `workspace`, or the panel's **All chats** toggle).
One file with a chat column, not one file per chat: the history cannot drift out of the
ledger it belongs to, and a new chat starts empty without deleting anything. Rows written
before `chatId` existed fall back to `parentSessionId`; rows with neither are workspace
history that only the human can edit.

The `agents[]` section is the persistent role registry: one child session per role, reused by every task that fits it. A role is not a task title. The file is the durable record. It survives a Host restart, lives in the
checkout's `.dsh/` directory (gitignored), and is the same document the browser
displays. Child→task links are persisted in `$DSH_HOME/taskboard-child-links.json`,
so a `subagent/end` after a Host or plugin reload still settles the task.

## Model surface

`task_create`, `task_get`, `task_list`, `task_update` (compare-and-set on
`expectedRevision`), `task_note`, `task_link`, and the lifecycle tools
`task_pause`, `task_resume`, `task_close`, `task_cancel`, `task_remove`. The orchestrator's
`delegate_task` requires a `role` (e.g. `UX/UI`, `BACKEND`, `BUSINESS`, `RESEARCH`) and reuses
that role's existing child session; it starts a child only when the role has none. The taskboard
stores the role registry in `agents[]`. Pause/close interrupt linked children through
`ctx.subagents`; a failed interrupt is reported per child and the task stays in its previous
state (fail closed).

`task_list` takes `scope: chat` (default) or `scope: workspace`; `task_get` reads any task by
id, because knowing the id is the reason to look. A write from another chat is refused with
`other_chat` for an agent and allowed for the human, who owns the board; the refusal exists
so an id guessed or carried over from an earlier chat cannot silently rewrite work this chat
cannot see.

## Browser surface

- **Tasks** in the session header replaces the `subagent-catalog` cell. It is a
  ghost header action: the label is followed by a separate bordered count pill,
  so it reads `Tasks 4`, never a run-together `Tasks4`.
- **Tasks** icon in the sidebar panel list opens the full page. The icon inherits
  the row label color and draws no fill or border of its own; the sidebar row owns
  the selected background.
- **Board + detail**: five workflow columns — Open, Active, Review, Blocked, Done. The
  two states that are not stages share the column they belong to: a `paused` card sits
  under Active and a `cancelled` card under Done, and the card chip still says paused or
  cancelled. A detail panel edits title, status, objective, scope, non-scope, acceptance,
  result summary, evidence and the blocked reason, and states the one assignment rule
  above the status row. The detail stacks under the board when the panel is narrower than
  920px, and each list field shows four lines before scrolling (96px/84px textareas).
- **Back** is the leftmost top-bar action. It returns to the conversation from which the panel was opened: the header trigger captures its exact session, and the sidebar entry captures the retained main-view conversation. It is hidden when there is no originating chat.
- **Hide** lives in the task-detail header, beside the task id and title; it
  collapses the right pane and gives the board the full width. The selection is
  kept, and clicking or keyboard-selecting any card reopens the detail. There is
  no show/hide control in the top bar.
- **Scaling**: a **Board / List** switch sits in the top bar. List is the dense scan view — one row per task with **Status, Role, Task, Owner, Updated** — and becomes the default when a board has more than 8 tasks. The Role cell is the role chip plus its preset id and the child count, so the old Subagents column has no column of its own; Owner shows the child's label, `inline`, or `unowned`. A filter row adds title/scope/owner search and a status filter over all seven states; both views use the same filtered set and keep the detail pane. The kanban stays available for workflow shaped work.
- **Scope**: the filter row starts with **This chat / All chats**. This chat is the default
  and is the chat's board; All chats reads the whole workspace history in place, with
  foreign rows marked `other chat` (card chip and list column), and **Back** to This chat
  when the conversation changes. The header count, the top-bar count and the filter count
  all follow the active scope, and a chat with no tasks says how many exist elsewhere
  instead of looking broken. Switching scope drops a selection that is not in the new
  working set, so the detail pane never shows a task the visible board says is not there.
- **Wheel scrolling**: wheel input over the board is captured as one horizontal
  axis. A vertical mouse wheel, a horizontal trackpad gesture, and a diagonal
  gesture all move the board sideways; the page does not scroll vertically at
  the same time. The listener is native and non-passive. At a horizontal edge
  the board stops rather than chaining the page. Move the pointer off the board
  to scroll the page. The list view keeps normal vertical page scrolling.
- **Subagents**: a task's `children[]` entries render as role-first rows with the
  label/id, an `active`/`sleeping`/`paused` badge and an **Open** action. A
  one-line summary above the rows reads e.g.
  `2 subagents · 1 active · 1 sleeping`. The board top carries a compact roster
  with total, active, sleeping (paused/linked when present) and every role name
  with its count. **The roster describes the board in view**: in *This chat* it
  counts only the roles linked to this chat's tasks (rows opened for them, or
  rows recording this chat), and *All chats* switches the label to **Workspace
  roles** and counts the whole `agents[]` registry. Reading it off the whole
  registry reported specialists from earlier chats that nobody here could reach.
  Card chips show the role (or `inline`), the child count and its
  active/sleeping split. Tasks without `children[]` fall back to
  `childSessionIds[]` with role `child` and neutral state `linked`.
- **Lifecycle**: **Pause** moves the task to `paused` and interrupts its linked
  child sessions; **Resume** moves it back to `active` (it does not auto-prompt a
  child; open the child to continue). **Cancel** abandons the task, interrupts its
  children and keeps the row as `cancelled` with the reason on its decisions — the
  only door for a paused task or one that still has children. **Close** accepts a task as done and
  interrupts children; it is enabled only for a task in review, because acceptance
  is the one door to `done`, and it refuses to mark done if the subagent service
  cannot be reached. **Remove** deletes the task and its timeline after a
  confirmation, and deliberately leaves child sessions running. `paused` and
  `done` are lifecycle states, not ordinary edit values: the status select
  disables those options and Save never submits them; `blocked` needs the reason
  in the field beside it. Host refusals such as `needs_role_or_inline`,
  `needs_result`, `needs_evidence`, `needs_reason`, `use_pause`, `use_close`,
  `needs_review`, `terminal`, `empty_title` or `interrupt_failed` are shown as
  errors in the detail pane. The header badge counts the same chat the pane shows:
  it resolves the session to the root of its lineage (`chatIdOf`) instead of comparing a
  task's `chatId` with the raw session id, which showed 0 on a child conversation.
- **Timeline**: created, edited, delegated, child started/finished, paused,
  resumed, closed, notes.
- **Child sessions**: each linked child opens its existing conversation.
- **Artifacts**: paths from the result, ready for `present` or the preview.

The browser reads the ledger through the existing `workspaceFiles.read` Remote
and writes through the existing `/taskboard` command Remote. There is no custom
Typert namespace and no second RPC layer.

## Save model

Save is kept on purpose. It is an explicit commit of one batch of fields, not a
keystroke autosave. The Host's compare-and-set (`expectedRevision`) has one
well-defined moment to succeed or return a stale conflict, so two editors cannot
interleave silently; a debounce would move that moment around without removing
the conflict. The client therefore:

- keeps the dirty hint and the disabled **Saved** state;
- disables Save for an empty title and says why;
- preserves acceptance `{text,done}` flags when the text is unchanged, and keeps
  `result.artifacts`, `result.decisions` and `result.risks` when saving
  summary/evidence;
- merges the returned task immediately, so Save visibly advances `rev`;
- treats a write without a recognizable command result as an error;
- keeps the board, selection and draft on a failed write. A background poll may
  not clear a write error; only a successful write does;
- when a poll sees a new revision while the draft is dirty, keeps the draft and
  shows a conflict banner with **Refresh** instead of discarding the edit.

The page picks a live/retained session for the selected workspace
(`retainedBy.mainView > 0` from the `useSessions` standard prop) rather than
`sessionIds[0]`. When no live session exists, the board is read-only and says
**Open a live conversation to edit this board**; Save and lifecycle actions are
disabled instead of failing silently. The header trigger still passes its exact
live session and is left alone.

## Failure behavior

- A stale save is rejected with the current revision; the client keeps the dirty
  draft and offers Refresh. A malformed ledger fails the read loudly rather than
  replacing the human's work. The Host writes temp-file + rename, so a crash
  cannot leave half a JSON document.
- A write from another chat is refused with `other_chat` for an agent; the panel
  (the human) may still fix an old row it is reading, which is why Remove on an
  earlier chat's task works from the All-chats view.
- A read stops on `eof`. If the ledger does not reach `eof` within 200 pages of
  2,000 lines, the read returns `ledger is too large to read` instead of parsing
  truncated JSON (a maximal board is about 75 pages).
- **The cap counts work in flight, not history.** `maxTasks` (default 200) limits the
  tasks that can still be acted on — open, active, paused, review, blocked — and a create
  past it is refused with `board_full` plus the counts (`active`, `cap`). Finished and
  cancelled rows are the record of what the board did; they do not occupy a slot, so a
  workspace with 190 done rows and 5 open ones can still add work. A second, larger limit
  guards the FILE: at `maxRows` (default 1000) a create is refused with `board_rows_full`
  (`rows`, `cap`). The Host never evicts, deletes or rewrites a row to make space — a full
  board is answered by closing or cancelling what is finished, or by raising the cap in the
  profile.
- The ledger has no cross-process file lock. Run one DSH host per workspace;
  a second host writing the same checkout can lose an update (the UI shows the
  `session/writer-held` failure instead of pretending it saved).
