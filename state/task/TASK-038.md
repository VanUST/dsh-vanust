---
id: TASK-038
kind: task
title: "Session-scoped taskboard with opt-in global view"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.412Z
updatedAt: 2026-11-17T15:52:39.412Z
acceptance:
  - text: "A fresh chat's task_list returns only its own tasks; task_list with the global scope returns every task in the workspace file"
    done: false
  - text: "Two chats in the same workspace see disjoint boards without touching each other's rows"
    done: false
  - text: "The Tasks panel shows only the current chat's tasks and has an explicit global toggle"
    done: false
  - text: "A delegated child's task_create lands in the parent chat's scope"
    done: false
  - text: "Legacy rows without an owner session do not appear in the default view"
    done: false
  - text: "Proven by running: a second dsh web instance on another port (or the equivalent live probe) shows the two boards and the toggle, with commands and output quoted"
    done: false
  - text: "Kit gates that touch the plugin pass (pack-plugin, check-portability)"
    done: false
  - text: "Version bumped, README and USERGUIDE rows updated, tarball repacked"
    done: false
boardId: task-mwan6ni6-om2ni0
nonScope: ["the session-store.mjs boot guard and the five files it touches - another chat has that change uncommitted, do not touch or commit it", "the harness packages under node_modules", "rewriting the board JSON schema in a way that drops existing tasks"]
resultEvidence: ["node /tmp/taskboard-scope-probe.mjs -> 16/16 PASS, exit 0 (real plugin, fake Cordis ctx: root create chat-a; child create chat-a; other chat sees 0; workspace scope sees all; task_get global; foreign update other_chat; own update ok; child note ok; legacy row out of chat board and in workspace history; agent cannot claim chatless row; command list chat-scoped; command create from child lands on parent; human cleans chatless row)", "second dsh web on :3081 against the real profile -> fresh chat panel: count 0, '0 / 0 - 169 elsewhere', detail 'No tasks in this chat yet...'; All chats: 169 rows, 163 marked 'other chat', 169/169; Back to This chat clears the foreign detail selection; browser console errors 0", "node scripts/check-portability.mjs -> 17/17 PASS; node scripts/check-documentation.mjs -> documentation ok", "screenshots .dsh/screenshots/taskboard-scope-chat.png and taskboard-all-chats.png"]
resultSummary: "Tasks are scoped to the chat that created them, and the workspace history is an explicit read (task_list scope workspace, or the panel's All chats toggle). One ledger keeps everything; chatId is the root session of the creating lineage so a delegated child's task lands on the parent chat's board. Rows written before chatId fall back to parentSessionId; chatless rows are human-only. An agent write from another chat is refused with other_chat; the human keeps the whole board. Taskboard 0.1.33 and orchestrator 0.1.18 shipped and installed into the profile; commit f80d7b8."
scope: [plugins/taskboard/taskboard.mjs, plugins/taskboard/client.js, plugins/taskboard/README.md, plugins/taskboard/package.json, profile/cordis.patch.yml, "plugins/orchestrator/orchestrator.mjs (only the board-debt/role read scoping)", USERGUIDE.md, README.md, inventory/tarball]
---

Tasks created in a chat are visible only in that chat by default, to the human and to the agent; the ledger stays one workspace file so nothing is lost. The agent can read the whole workspace history on demand (a scope/global flag on task_list/task_get, not a second store). A delegated child's task lands in its parent chat's board. Legacy tasks (no session owner) are visible only in the global view.

Migrated from .dsh/taskboard.json (task task-mwan6ni6-om2ni0, revision 2).
