---
id: TASK-005
kind: task
title: "Ship @cc/dsh-rtk: command-aware output seam over the rtk binary"
status: done
revision: 1
createdAt: 2026-11-17T15:52:39.007Z
updatedAt: 2026-11-17T15:52:39.007Z
boardId: task-mvp4hhu7-pgt0hj
ownerRole: RTK-OUTPUT
---

Ship a new host-only Cordis plugin `plugins/rtk/` (package `@cc/dsh-rtk`) for the dsh-kit at /home/iustimov/dsh-kit. It must do two things: (1) register one system-prompt section that tells the agent the `rtk` binary is installed, where it is, and which shell commands to prefix with `rtk` when it wants full control; (2) listen on the harness's `tools/post-execute` waterfall and, for shell tool calls only, pipe an oversized result through `rtk pipe -f <filter>` and replace the model-facing projection with the filtered text. This is the whole point: DSH's `tools/pre-execute` explicitly cannot rewrite arguments, so the binary cannot transparently rewrite `git status` into `rtk git status` the way upstream's Claude Code hook does. The output seam is the honest place, and `rtk pipe` makes it possible. Prove real byte savings on real commands, and never corrupt a result the filter does not understand.

Migrated from .dsh/taskboard.json (task task-mvp4hhu7-pgt0hj, revision 7).
