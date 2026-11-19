---
id: TASK-043
kind: task
title: "Probe: does a fresh child have shell access?"
status: cancelled
revision: 2
createdAt: 2026-11-17T15:52:39.478Z
updatedAt: 2026-11-17T15:52:39.478Z
acceptance:
  - text: "The report contains the three command outputs and exit codes, or the exact tool error that prevented them"
    done: false
boardId: task-mwao4fo3-8vsgu1
nonScope: ["no writes, no installs, no server restart in this probe"]
ownerRole: BACKEND
role: BACKEND
scope: ["read-only shell commands in /home/iustimov/dsh-kit"]
---

Determine whether a child agent started now has working shell and file tools. Run exactly: `pwd`, `which bash`, `ls /home/iustimov/dsh-kit/plugins | head -5`, and print each command with its exit code. Change nothing.

Migrated from .dsh/taskboard.json (task task-mwao4fo3-8vsgu1, revision 2).
