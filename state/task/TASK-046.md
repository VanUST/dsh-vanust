---
id: TASK-046
kind: task
title: "Probe: REVIEWER role tool surface"
status: done
revision: 2
createdAt: 2026-11-17T15:52:39.513Z
updatedAt: 2026-11-17T15:52:39.513Z
acceptance:
  - text: "The report lists the exact tool names and states whether write and edit exist"
    done: false
  - text: "The report shows pwd output proving the shell works, and nothing was written"
    done: false
boardId: task-mwaoakdq-k3lsjj
nonScope: ["no writes of any kind", "do not use the shell to create the probe file"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: f8e38bf9-2a2a-4640-9c5f-ee0bd544643b
ownerRole: REVIEWER
role: REVIEWER
scope: ["read-only shell commands in /home/iustimov/dsh-kit"]
sessions:
  - sessionId: f8e38bf9-2a2a-4640-9c5f-ee0bd544643b
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Report the exact tool surface of your session. Run `pwd; echo exit=$?`. List the exact names of every tool you can call and state explicitly whether `write` and `edit` are among them. Do not write anything, including through the shell.

Migrated from .dsh/taskboard.json (task task-mwaoakdq-k3lsjj, revision 6).
