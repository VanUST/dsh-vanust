---
id: TASK-035
kind: task
title: "Notify only on real completion, root sessions only, one aggregated popup"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.375Z
updatedAt: 2026-11-17T15:52:39.375Z
boardId: task-mw9dtvk4-0badvk
---

The notify plugin pings on every turn boundary, including subagent turns and goal-driven intermediate rounds, and raises a separate persistent popup per event that must be dismissed one by one. Change it to: (1) fire only for root chat agents (a child carries parentSession/origin 'subagent' even when delegationDepth is 0), (2) wait a settle window after running->idle so a continuation inside the window suppresses the popup, (3) keep ONE popup whose body has one line per finished session instead of a stack, dismissing them all at once.

Migrated from .dsh/taskboard.json (task task-mw9dtvk4-0badvk, revision 2).
