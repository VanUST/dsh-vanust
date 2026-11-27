---
id: TASK-335
kind: task
title: "Owner status change displays immediately and never lies"
status: done
revision: 3
createdAt: 2026-11-27T10:09:21.379Z
updatedAt: 2026-11-27T10:09:50.902Z
acceptance:
  - text: "the select shows the chosen status before the command's round trip (measured: UI review at ~150 ms while the TASK file still says active)"
    done: false
  - text: "a refusal restores the previous status and shows its code (unit: applyTaskStatus revert path; source test pins it)"
    done: false
  - text: "a successful write refreshes the session-header counters immediately through the dsh:project-state-changed event"
    done: false
  - text: "plugins/project-state-panel test files pass; the panel tarball matches the tree"
    done: false
boardId: task-mwytkihy-p8tfoe
inline: true
reqId: REQ-136
reqIds: [REQ-136]
resultEvidence: ["browser poll reports/status-display/proof.out: ui 'review' at 150 ms while state/task/TASK-333.md is still 'active'; file 'review' at 450 ms; index 'review' at 600 ms; revert shows 'active' at once", "node --test plugins/project-state-panel/test/status-display.test.mjs -> 4 pass (optimistic patch, refusal restore, cache guard, header event)", "node --test plugins/project-state-panel/test/*.test.mjs -> 23 pass", "node scripts/check-portability.mjs -> 20/20 (cc-dsh-project-state-panel-0.1.51.tgz matches the tree)"]
resultSummary: "The owner's status badge now shows the chosen status on the next paint: the panel patches its data before sending /taskboard owner-status, restores the previous value with the refusal code if the board refuses, stops the first-paint cache from repainting the pre-write index over live data, and raises dsh:project-state-changed so the session-header counters re-read at once. Measured on a second server: the select shows review at ~150 ms while the TASK file is still active (file 450 ms, index 600 ms); before the fix the select stayed active for ~1.5 s. Payload: plugins/project-state-panel/client.js, status-display.test.mjs, README; tarball 0.1.51."
steps: ["applyTaskStatus pure helper: patch the index row and the loaded entity", "changeStatus patches before the command, restores on refusal, keeps the value on success and dispatches dsh:project-state-changed", "first-paint cache guard: never repaint the cached index over ready/refreshing data", "PanelTrigger listens for the event and re-reads index.json immediately", "status-display.test.mjs: helper, call order, refusal restore, cache guard, header listener", "browser poll on the second server: UI review before the file/index change; revert; gates and repack"]
stepsDone: 6
---

Fix the owner's status control: selecting a status on the Board badge must show the new status immediately, before the board/TASK/index round trip; a refused write must restore the previous value and name the code; a successful write must refresh the session-header counters at once. The cause was that the patch was applied only after the command answered and the first-paint cache repainted the old index on the reload, so the controlled select painted the old status for ~1.5 s (the owner's "nothing changes").
