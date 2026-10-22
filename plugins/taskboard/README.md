# @cc/dsh-taskboard

The task-centered dashboard that replaces the subagent catalog as the place work
is tracked.

## What it stores

One JSON ledger per session workspace, `.dsh/taskboard.json`:

- `id`, `revision`, `title`, `objective`
- `scope[]`, `nonScope[]`, `acceptance[{text,done}]`
- `status` — proposed, ready, active, paused, review, done, blocked, cancelled
- `priority`, `owner`, `parentId`, `parentSessionId`, `dependsOn[]`, `childSessionIds[]`,
  `children[{sessionId,label,role,status,startedAt,endedAt,stopReason}]`
- `role` on a task; `agents[{role,label,sessionId,status,taskCount,lastTaskId}]` for the persistent specialist roster
- `result { summary, evidence[], artifacts[], decisions[], risks[] }`
- `timeline[{at, kind, actor, text, sessionId?}]`

The `agents[]` section is the persistent role registry: one child session per role, reused by every task that fits it. A role is not a task title. The file is the durable record. It survives a Host restart, lives in the
checkout's `.dsh/` directory (gitignored), and is the same document the browser
displays. Child→task links are persisted in `$DSH_HOME/taskboard-child-links.json`,
so a `subagent/end` after a Host or plugin reload still settles the task.

## Model surface

`task_create`, `task_get`, `task_list`, `task_update` (compare-and-set on
`expectedRevision`), `task_note`, `task_link`, and the lifecycle tools
`task_pause`, `task_resume`, `task_close`, `task_remove`. The orchestrator's
`delegate_task` requires a `role` (e.g. `UX/UI`, `BACKEND`, `BUSINESS`, `RESEARCH`) and reuses
that role's existing child session; it starts a child only when the role has none. The taskboard
stores the role registry in `agents[]`. Pause/close interrupt linked children through
`ctx.subagents`; a failed interrupt is reported per child and the task stays in its previous
state (fail closed).

## Browser surface

- **Tasks** in the session header replaces the `subagent-catalog` cell. It is a
  ghost header action: the label is followed by a separate bordered count pill,
  so it reads `Tasks 4`, never a run-together `Tasks4`.
- **Tasks** icon in the sidebar panel list opens the full page. The icon inherits
  the row label color and draws no fill or border of its own; the sidebar row owns
  the selected background.
- **Board + detail**: eight status columns, a detail panel with editable title,
  status, objective, scope, non-scope, acceptance, result summary and evidence.
  The detail stacks under the board when the panel is narrower than 920px, and
  each list field shows four lines before scrolling (96px/84px textareas).
- **Hide** lives in the task-detail header, beside the task id and title; it
  collapses the right pane and gives the board the full width. The selection is
  kept, and clicking or keyboard-selecting any card reopens the detail. There is
  no show/hide control in the top bar.
- **Wheel scrolling**: a plain vertical mouse wheel over the board scrolls it
  horizontally. The listener is a native, non-passive `wheel` listener attached
  to the board and removed on unmount. At either horizontal edge the event is
  left to the page, and a horizontal trackpad delta (`deltaX`) is never hijacked.
- **Subagents**: the board's `agents[]` registry drives the workspace roster; a task's `children[]` entries render as role-first rows with the
  label/id, an `active`/`sleeping`/`paused` badge and an **Open** action. A
  one-line summary above the rows reads e.g.
  `2 subagents · 1 active · 1 sleeping`. The board top carries a compact
  workspace roster with total, active, sleeping (paused/linked when present) and
  every role name with its count. Card chips show the first role, `+N`, and the
  active/sleeping counts. Tasks without `children[]` fall back to
  `childSessionIds[]` with role `child` and neutral state `linked`.
- **Lifecycle**: **Pause** moves the task to `paused` and interrupts its linked
  child sessions; **Resume** moves it back to `active` (it does not auto-prompt a
  child; open the child to continue). **Close** marks it done and interrupts
  children; if the subagent service cannot be reached it refuses to mark done. **Remove** deletes the task and its timeline after a
  confirmation, and deliberately leaves child sessions running. `paused` and
  `done` are lifecycle states, not ordinary edit values: the status select
  disables those options and Save never submits them. Host refusals such as
  `use_pause`, `use_close`, `empty_title` or `interrupt_failed` are shown as
  errors.
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
- A read stops on `eof`. If the ledger does not reach `eof` within 200 pages of
  2,000 lines, the read returns `ledger is too large to read` instead of parsing
  truncated JSON (a maximal board is about 75 pages).
- At the configured cap (default 200 tasks) a create is refused with
  `board_full`; the Host never evicts an older task as a side effect of a write.
- The ledger has no cross-process file lock. Run one DSH host per workspace;
  a second host writing the same checkout can lose an update (the UI shows the
  `session/writer-held` failure instead of pretending it saved).
