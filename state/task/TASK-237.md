---
id: TASK-237
kind: task
title: "Stop the state feed from writing unidentified messages, and repair the sessions it corrupted"
status: open
revision: 1
createdAt: 2026-11-18T14:23:27.840Z
updatedAt: 2026-11-18T14:23:27.840Z
boardId: task-mwm7on1p-lc69tx
chore: true
choreReason: "A defect in the state-feed plugin makes every session it touched unloadable; repairing it is required before the state panel can be used at all, and it maps to no existing requirement."
inline: true
steps: ["Reproduce the failing check against the stored logs with the harness's own validator", "Fix stateMessage() to produce an identified UserMessage", "Repack and install the fixed plugin into the web profile", "Write an idempotent repair script that adds a missing id and preserves every other byte", "Repair the affected session logs (skipping the live one) with a backup", "Verify each repaired session passes adoptSessionEvent and opens in the GUI", "Report the cause, the repair and the residual caveat"]
stepsDone: 0
---

Every root session that received the state-feed injection stores a `user/message` event with no `id`, so the loader refuses the whole session with "event at seq N lacks an identified message". Fix the injection to build a complete UserMessage via the harness contract, reinstall the plugin, and repair the already-corrupted session logs in place (idempotent, backed up, verified by the harness's own validator).
