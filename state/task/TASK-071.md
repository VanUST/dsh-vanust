---
id: TASK-071
kind: task
title: "Board cap counts terminal rows, blocks new tasks at 198/200"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.831Z
updatedAt: 2026-11-17T15:52:39.831Z
boardId: task-mwauclgk-i1rp7p
ownerRole: BACKEND
---

Fix the board cap so terminal history cannot block new work: the autolabel workspace sits at 198/200 tasks (mostly done/cancelled) and the panel now refuses +New task with board_full, although almost nothing is active. Count only non-terminal tasks (or raise the cap) and keep a named refusal for a truly full active board.

Migrated from .dsh/taskboard.json (task task-mwauclgk-i1rp7p, revision 7).
