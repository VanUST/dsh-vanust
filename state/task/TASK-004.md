---
id: TASK-004
kind: task
title: "UX pass — detail hide, wheel scroll, Save model"
status: done
revision: 2
createdAt: 2026-11-17T15:52:38.995Z
updatedAt: 2026-11-17T15:52:38.995Z
acceptance:
  - text: "hide control lives in the detail header and selecting a card reopens it"
    done: false
  - text: "vertical wheel over the board scrolls horizontally without breaking page scroll at the edges"
    done: false
  - text: "Save is either removed with an honest save model or kept with a clear, proven job"
    done: false
  - text: "accessibility and all eight columns preserved"
    done: false
  - text: "no backend/profile edits and no tests"
    done: false
boardId: task-mvjlpzxz-vhg0hz
nonScope: ["no taskboard.mjs edits", "no profile, tarball, or server changes", "no tests or new dependencies"]
owner:
  kind: agent
  label: "UX reviewer"
  sessionId: 8b3f6ad1-627c-49c9-b22f-31058ae84391
resultArtifacts: [reports/harness-integration/assets/taskboard-live.png, reports/harness-integration/assets/taskboard-header.png]
resultEvidence: ["node --check plugins/taskboard/client.js exit 0", "live 3095: header text 'Tasks 4' with bordered count pill; computed trigger background transparent, border 0; count margin 4px", "live 3095: sidebar icon computed background transparent, border 0, padding 5px; no native gray square", "live 3095: UI Save changed title and revision 1->2; Pause -> paused rev3; Resume -> active rev4; Close -> done rev5; Remove deleted the row", "live 3095: Hide removed the detail pane; selecting a card reopened it; wheel event moved board scrollLeft 708->968 and prevented default", "roster reads 3 subagents, 0 active, 3 sleeping, roles Backend reviewer / UX reviewer / UX/UI review"]
resultSummary: "UX pass shipped and verified on the single-host 3095 UI: detail Hide control, card-reopen, native wheel-to-horizontal scroll, readable ghost header/count and transparent sidebar icon, canEdit/live-session guard, merge-safe Save with dirty/conflict state, 200-page ledger read, and a subagent roster with roles and active/sleeping counts. Old tasks without children[] now infer role/status from owner and timeline."
scope: [plugins/taskboard/client.js, plugins/taskboard/README.md]
sessions:
  - sessionId: 8b3f6ad1-627c-49c9-b22f-31058ae84391
---

Enhance the Tasks panel UX in plugins/taskboard/client.js: move the hide control into the task detail header, make a vertical mouse wheel over the board scroll horizontally, and make the edit model understandable (keep Save only if it has a clear job). Preserve accessibility, eight columns, lifecycle actions and the existing data flow.

Migrated from .dsh/taskboard.json (task task-mvjlpzxz-vhg0hz, revision 5).
