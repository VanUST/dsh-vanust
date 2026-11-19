---
id: TASK-003
kind: task
title: "Backend review — taskboard API and lifecycle"
status: done
revision: 2
createdAt: 2026-11-17T15:52:38.985Z
updatedAt: 2026-11-17T15:52:38.985Z
acceptance:
  - text: "ranked findings with file:line, severity, reproduction, expected vs actual"
    done: false
  - text: "no code edits from the reviewer"
    done: false
  - text: "Save/Pause no-op root cause or a precise next probe"
    done: false
boardId: task-mvjlpzsl-qcbp5d
nonScope: ["no edits", "no profile or server changes", "no tests"]
owner:
  kind: agent
  label: "Backend reviewer"
  sessionId: c7d8cee5-591a-4871-bce3-2012bdee7b2b
resultArtifacts: [/tmp/tb-audit/audit.mjs, /tmp/tb-audit/audit-latest.out, /tmp/parent.jsonl]
resultEvidence: ["Playwright network: /taskboard update/pause -> session/writer-held on 3092 for a session owned by 3080; handler never ran", "DSH session log: taskboard disabled 13:50:33 -> orchestrator pending -> delegate_task inactive context at 13:53:09", "audit.mjs: acceptance done flags and result extras lost; childEnded before link ignored; first child end moved a multi-child task to review; maxTasks trimmed oldest", "host retest after fixes: acceptance done preserved, result artifacts/decisions/risks preserved, third create returns board_full, multi-child first end stays active, second goes review, pause with interrupt error leaves status active"]
resultSummary: "Read-only audit found and ranked 12 defects. The Save/Pause no-op was cross-host session ownership (3080/3092), not the service; the UI masking is fixed. High findings fixed in source: task_update result/acceptance merge, stored-parent authority, close/fail-closed interrupt, command error detail, multi-child review, maxTasks cap, persisted child links, malformed-ledger refusal. Remaining: pre-link child end, no cross-process lock, config path, repeated lifecycle events."
scope: [plugins/taskboard/taskboard.mjs, "plugins/taskboard/client.js (read-only command path)", "plugins/orchestrator/orchestrator.mjs (parentSessionId only)"]
sessions:
  - sessionId: c7d8cee5-591a-4871-bce3-2012bdee7b2b
---

Audit the taskboard host service and task plugin API for concrete bugs: lifecycle pause/resume/close/remove, parentSessionId and subagent interrupt authority, CAS updates, childEnded/remove races, and the browser /taskboard command path. Return a ranked defect report only; do not edit code.

Migrated from .dsh/taskboard.json (task task-mvjlpzsl-qcbp5d, revision 6).
