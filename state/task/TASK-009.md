---
id: TASK-009
kind: task
title: "Audit the four integrations against the running server"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.056Z
updatedAt: 2026-11-17T15:52:39.056Z
boardId: task-mvp86bb6-v6pw8p
---

For each of the four integrated features, name it, prove it is wired in the RUNNING server, and break it on purpose. Found and fixed one defect the review missed: the rtk classifier refused every real harness command because the harness prefixes each shell call with `cd <cwd> &&`.

Migrated from .dsh/taskboard.json (task task-mvp86bb6-v6pw8p, revision 4).
