---
id: TASK-083
kind: task
title: "Enforce roles on every child agent"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:40.014Z
updatedAt: 2026-11-17T15:52:40.014Z
acceptance:
  - text: "The orchestrator cannot launch a task-bearing child through direct subagent/subagent_fork; attempted use returns a clear refusal naming delegate_task."
    done: false
  - text: "delegate_task and legitimate internal subagent startActivation/sendMessage remain functional."
    done: false
  - text: "A real child launched by delegate_task proves agent-preset/selected matches its role, role persona/instructions are present, and its tool set differs by role (e.g. reviewer has no write/edit)."
    done: false
  - text: "The audit records which historical children were compliant and which three were generic, with session evidence."
    done: false
  - text: "make verify and exact proof commands/output/exit codes pass/recorded."
    done: false
boardId: task-mwc0hfs8-b8mhxs
nonScope: ["Do not remove generic subagent capability from non-orchestrator agents unless evidence requires it.", "Do not alter delegate_task's correct role-preset behavior or existing raw task history.", "No live :3080 restart during proof; use headless/second profile.", "No autotests."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
ownerRole: BACKEND
preset: backend
resultEvidence: ["reports/role-enforcement/audit-sessions.json: compliant 913d/backend, e69c/reviewer, b7de/ux, cfdf/docs; generic a89c, 92a, 63ee with no preset and full tools", "reports/role-enforcement/evidence.json: direct subagent refused; delegate_task reviewer child preset=reviewer with no write/edit and reviewer persona", "plugins/orchestrator/orchestrator.mjs: root-only tools.guard for subagent/subagent_fork", "plugins/cc-dsh-orchestrator-0.1.25.tgz: repacked source", "reports/role-enforcement/make-verify.txt: 17/17 packaging and documentation ok"]
resultSummary: "Audit found four role-delegated children with correct preset, persona and restricted tools, and three generic direct-subagent children with no preset and the full root tool set. The cause was direct subagent/subagent_fork bypassing delegate_task. A root-only monotonic tools.guard now denies those direct tools and names delegate_task; a real second-server proof showed the refusal and then a legitimate delegate_task reviewer child with reviewer preset, reviewer persona and no write/edit. Orchestrator package is 0.1.25 and make verify is green."
role: BACKEND
scope: [plugins/orchestrator/, "profile/cordis.patch.yml or directly related preset/tool policy", reports/role-enforcement/, "directly related tests/checks/docs"]
sessions:
  - sessionId: 913d5bfc-967b-4ad7-b79e-16f378fa25a8
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Close the audited role-enforcement gap: direct subagent/subagent_fork calls from the orchestrator can create children with no agent preset, no role persona and the root tool set, even when the taskboard labels them BACKEND. Enforce that every delegated child that performs task work starts through delegate_task with a real preset, and prove actual agent-preset/selected plus role-specific tools.

Migrated from .dsh/taskboard.json (task task-mwc0hfs8-b8mhxs, revision 7).
