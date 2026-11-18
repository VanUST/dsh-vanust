---
id: TEST-061
kind: test
title: "Board list sorts tasks"
status: verified
revision: 3
createdAt: 2026-11-18T12:46:00.747Z
updatedAt: 2026-11-18T12:46:11.260Z
authorRole: BACKEND
caseId: board-list-sorts-tasks
command: "node --test plugins/project-state-panel/test/counts-and-sort.test.mjs"
evidenceRefs: [mwm47g8w-kstww-1:red:fail, mwm47j4l-1n18z-1:green:pass]
frozenHash: c19305823f419f013a99217bb33070b7d23001685d4f9d9c30fedf77e363aaaa
reqId: REQ-116
testPath: plugins/project-state-panel/test/counts-and-sort.test.mjs
---

The Task board mode offers a Board/List switch; List renders a Status/Task/Requirement/Progress/Updated table with sort tags Relevance (default), Updated, Status and Title, each reflecting the choice through aria-pressed. Relevance is active → blocked → review → open → done → cancelled, then more steps done, then updatedAt descending, then id.
