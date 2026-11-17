---
id: TASK-039
kind: task
title: "Role presets: orchestrator + 5 specialists with isolated tools and prompts"
status: review
revision: 1
createdAt: 2026-11-17T15:52:39.427Z
updatedAt: 2026-11-17T15:52:39.427Z
boardId: task-mwan6nl0-vik1oe
---

Each role is a first-class agent preset: own persona/prompt and only the tool set it needs. Orchestrator is the root of every chat, owns system design and the board, is the only one that picks a role for a task, and has no code-mutating tools at all. Specialists (UX/UI designer-tester, backend, researcher, documenter, reviewer) each get their role tools plus a shared common set. Delegation carries the role as a preset (agentPreset/allowedAgentPresets), so isolation is structural, not a prompt promise.

Migrated from .dsh/taskboard.json (task task-mwan6nl0-vik1oe, revision 6).
