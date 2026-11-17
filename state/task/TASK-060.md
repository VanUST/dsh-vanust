---
id: TASK-060
kind: task
title: "Add the CRITIC role: adversarial general tester"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.686Z
updatedAt: 2026-11-17T15:52:39.686Z
boardId: task-mwar6ny9-2j8za8
ownerRole: BACKEND
---

Add a general critic/adversarial tester as a seventh specialist role: an agent whose brief is to try to break the algorithm/service within the stated constraints, find realistic non-trivial inputs and sequences that crash, hang, corrupt state or return a wrong answer, and report reproducible failures without fixing anything or touching production data. It is deliberately separate from UX/UI testing (interfaces) and from the reviewer (judges a diff).

Migrated from .dsh/taskboard.json (task task-mwar6ny9-2j8za8, revision 6).
