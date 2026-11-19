---
id: TEST-076
kind: test
title: "FR1: chore tasks can be hidden from the board and the list view"
status: verified
revision: 2
createdAt: 2026-11-19T11:30:56.333Z
updatedAt: 2026-11-19T11:30:56.372Z
authorRole: orchestrator
command: "node --test plugins/project-state-panel/test/counts-and-sort.test.mjs"
evidenceRefs: [panel-0.1.40:red:fail, panel-0.1.41:green:pass]
reqId: REQ-147
testPath: plugins/project-state-panel/test/counts-and-sort.test.mjs
links:
  - kind: task
    id: TASK-249
    hash: 2ed5b3f986d81d6816c126ab130824ff6964e4984f16991e9df854a1ec3e5984
---

Against the shipped 0.1.40 client the panel suite fails naming the missing isChoreTask, the absent hide-chores toggle and the unfiltered board/list; on 0.1.41 it is green. The browser proof on a second server (:3081, profile web-proof, panel 0.1.41) measured 249 rows with 3 chores by default, 246 rows after pressing the toggle (0 chore chips, count text 246 tasks), 246 cards in the grid, and every chore back after pressing again. state/ and .dsh/taskboard.json were byte-identical before and after the toggles: hiding is a view setting.
