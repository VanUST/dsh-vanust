---
id: TASK-155
kind: task
title: "Review the design-map readability fix (commit 6e7b54d)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.127Z
updatedAt: 2026-11-17T15:52:41.127Z
acceptance:
  - text: "Verdict is APPROVE or CHANGES_REQUIRED, with the evidence commands and their exit codes quoted"
    done: false
  - text: "The single-owner claim is checked: grep for any place that measures an edge label's width outside edgeLabelSize/labelPlate fallback"
    done: false
  - text: "Every write path is checked for whether it can persist a colliding scene (render, overlay merge, export, apply)"
    done: false
  - text: "The tests are checked for whether they could fail (negative control exists and was observed failing on the pre-fix scenes)"
    done: false
  - text: "Any finding names file:line and the concrete failing scenario"
    done: false
  - text: "No file is modified"
    done: false
boardId: task-mwjbwiye-uoxzac
nonScope: ["editing any file (review only)", "restarting or installing into the live :3080 profile", "changing designmap/model.yaml"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: b3ea897b-8156-4e45-9f21-74a47257e9da
ownerRole: REVIEWER
preset: reviewer
resultEvidence: ["REVIEWER verdict APPROVE; findings F1-F6", "follow-up commit f94a98c: fallback plate from labelBox/labelLines, refusal code by first issue, deleted placeLabelOutside/edgeLabelAnchor, self-loop refusal test, harness default repo, audit write-set no longer deletes out/", "112/112 tests, acceptance ok:true"]
resultSummary: "Independent review APPROVED the readability fix and reproduced every claim (labels box-owned, 16 real label_collision refusals on random dense models, red control on pre-fix scenes). Its six findings were all addressed in f94a98c; the one substantive one (React Flow fallback drawing labels by labelAt) now draws the validated labelBox."
role: REVIEWER
scope: ["read the diff of commit 6e7b54d in /home/iustimov/dsh-kit (git show 6e7b54d)", "run the designmap test suite, acceptance and audit commands", "read plugins/designmap/src/{text,layout,lint,render,schema,svg}.mjs, client/{excalidraw.js,canvas.jsx,view.jsx,frame.js}, bin/audit-scene.mjs, docs/designmap/SCENE-CONTRACT.md, plugins/designmap/README.md"]
sessions:
  - sessionId: b3ea897b-8156-4e45-9f21-74a47257e9da
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Independently judge whether commit 6e7b54d actually makes the Design map readable at the cause, and whether it can still emit a scene whose labels overlap nodes or whose edges cross nodes. Report APPROVE or CHANGES_REQUIRED with evidence, ranked findings and exact file:line references.

Migrated from .dsh/taskboard.json (task task-mwjbwiye-uoxzac, revision 6).
