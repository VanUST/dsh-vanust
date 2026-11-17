---
id: TASK-013
kind: task
title: "Two-model Kimi policy, highspeed guard, subagent wiring"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.106Z
updatedAt: 2026-11-17T15:52:39.106Z
boardId: task-mvyzj4zu-su8ssn
---

Enforce a two-model Kimi policy and make it reachable everywhere the harness chooses a model. Deliver: the kimi-coding catalog trimmed to k3.1-pro (smart) and kimi-for-coding (workhorse), with the highspeed variants gone; a guard that refuses any request naming a highspeed model instead of silently rewriting it; subagent model selection enabled for the three allowed routes (deepseek flash, kimi smart, kimi workhorse) so both the subagent tool and delegate_task can route a child to Kimi; and proof that each surface works.

Migrated from .dsh/taskboard.json (task task-mvyzj4zu-su8ssn, revision 3).
