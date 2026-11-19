---
id: TASK-088
kind: task
title: "Fix sleeping status during active work"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.092Z
updatedAt: 2026-11-17T15:52:40.092Z
acceptance:
  - text: "A real running command/background job while a task is active renders as working/running/waiting, never sleeping."
    done: false
  - text: "A genuinely idle completed child can still be sleeping."
    done: false
  - text: "Task status remains independent from agent state and neither is derived from a stale snapshot."
    done: false
  - text: "Regression proof covers synchronous bash, managed background job, child settled, and task closed cases in a real UI/session."
    done: false
  - text: "make verify passes."
    done: false
boardId: task-mwc2r3rq-xbdhct
nonScope: ["No cosmetic-only label change if underlying task/agent state is wrong.", "No live :3080 restart during proof.", "No test-cases host/panel changes."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
ownerRole: BACKEND
preset: backend
resultEvidence: ["plugins/taskboard/client.js: normalizeChildren/agentRowsFor/subagentRoster accept sessionsById and running=true overrides stored sleeping", "reports/taskboard-state/done-task-child-running.png: long-job task done, child shown active; running child probe active", "reports/taskboard-state/tasks-panel-running.png: live Tasks view during running work", "plugins/cc-dsh-taskboard-0.1.45.tgz matches source", "make verify exit 0"]
resultSummary: "Fixed the misleading sleeping badge by merging live session `running` state into taskboard child/role rows. A running child now renders active even if the ledger's last lifecycle value is sleeping; a settled child can still be sleeping. Proof captures active running children and a done task whose child is still active, and make verify passes."
role: BACKEND
scope: ["plugins/taskboard host/client and task model/status derivation", "plugins/orchestrator child/task lifecycle only if the state contract requires it", "reports/taskboard-state/ proof"]
sessions:
  - sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Correct the taskboard agent-state model so a child waiting on a running command/background job and an unfinished task is not shown as sleeping. Diagnose whether the defect is in child session status, task status, or the UI's merge of both, then fix the authoritative source once.

Migrated from .dsh/taskboard.json (task task-mwc2r3rq-xbdhct, revision 6).
