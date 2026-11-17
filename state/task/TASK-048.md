---
id: TASK-048
kind: task
title: "Compaction rewrites mid-turn: why image-offload and the pruner break the prefix cache"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.537Z
updatedAt: 2026-11-17T15:52:39.537Z
boardId: task-mwaopg6d-9p71dh
---

Explain why dsh-compaction-image-offload and dsh-compaction-tool-result-pruner rewrite history mid-turn (each rewrite invalidates the provider prefix cache from that position and re-bills the rest of a 200-500K context), measure the cost in real sessions, propose a design that keeps the rewrites at boundaries where the cache is already cold (or avoids them entirely), and prove the proposal on this deployment.

Migrated from .dsh/taskboard.json (task task-mwaopg6d-9p71dh, revision 2).
