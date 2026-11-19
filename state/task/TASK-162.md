---
id: TASK-162
kind: task
title: "Taskboard list mode: newest tasks first"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.250Z
updatedAt: 2026-11-17T15:52:41.250Z
boardId: task-mwjge19f-7ib905
inline: true
nonScope: ["The taskboard service and ledger ordering (board mode unchanged)", "The stored .dsh/taskboard.json", "Other panels"]
resultEvidence: ["packed cc-dsh-taskboard-0.1.56.tgz: comparator extracted from package/client.js and executed with samples -> b-newest > c-middle > a-old > e-tie-newer > d-tie-older > f-legacy; the input array was not mutated", "node --check plugins/taskboard/client.js -> ok", "make verify -> 17/17 portability and packaging checks passed + documentation ok (tarball matches source)"]
resultSummary: "TaskList now renders a sorted copy of the filtered tasks: updatedAt descending (most recent activity first), createdAt descending as a tie-break, then id for stability; a legacy row without updatedAt sorts last. The board/kanban branch still uses the ledger order, and the Updated column header carries a 'Newest activity first' title. Taskboard packed as 0.1.56 and make verify stays green."
scope: ["plugins/taskboard/client.js (list-mode ordering)", "plugins/taskboard/package.json (version) and the repacked tarball"]
---

In list mode the Tasks panel must show the most current tasks first: reverse the client-side list ordering so the newest activity sits at the top, without changing the board (kanban) ordering. Repack the taskboard plugin and keep the kit gates green.

Migrated from .dsh/taskboard.json (task task-mwjge19f-7ib905, revision 4).
