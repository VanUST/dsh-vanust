---
id: TASK-077
kind: task
title: "Review code-search integration"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.920Z
updatedAt: 2026-11-17T15:52:39.920Z
acceptance:
  - text: "Findings are severity-ranked with file:line and reproduction."
    done: false
  - text: "Verify actual tool lists for all role scopes, read-only/write risks and benchmark arm comparability."
    done: false
  - text: "Confirm or refute token/call/latency arithmetic from raw evidence."
    done: false
  - text: "Check Serena GPL/Apache Octocode metadata and fixed-repository bytes across benchmark arms."
    done: false
boardId: task-mwbwd0sg-6tja21
nonScope: ["No edits and no live :3080 profile changes.", "Do not repeat expensive model benchmark runs unless a specific disputed result requires one."]
owner:
  kind: agent
  label: REVIEWER
  sessionId: e69c228f-ee58-4a75-b566-2cdd82504074
ownerRole: REVIEWER
preset: reviewer
role: REVIEWER
scope: ["Read and run the resulting dsh-kit changes and reports/code-search/ artifacts", "Temporary read-only compose/probe commands"]
sessions:
  - sessionId: e69c228f-ee58-4a75-b566-2cdd82504074
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Independently review the Serena/Octocode integration and benchmark evidence after implementation. Check that every role receives the same static search tools, plus portability, MCP lifecycle, write boundaries, licence metadata, cache stability, benchmark fairness and whether reported numbers follow from raw session logs.

Migrated from .dsh/taskboard.json (task task-mwbwd0sg-6tja21, revision 10).
