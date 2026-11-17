---
id: TASK-037
kind: task
title: "Policy: no ad hoc fixes - check the architecture before patching"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.398Z
updatedAt: 2026-11-17T15:52:39.398Z
boardId: task-mw9fyzby-pdwezt
---

Add a named policy section to the root system prompt: before fixing a bug or building a feature, examine the design the change lands in - a symptom often comes from a wrong owner, duplicated state or a missing state-machine case. If the approach is wrong, revise the approach and say so; a patch that only hides the symptom must be named as one. Then repack, install, commit and push.

Migrated from .dsh/taskboard.json (task task-mw9fyzby-pdwezt, revision 2).
