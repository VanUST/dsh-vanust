---
id: TASK-181
kind: task
title: "tool-families: пресет из проекции и пересчёт при смене"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.635Z
updatedAt: 2026-11-17T15:52:41.635Z
boardId: task-mwkkohfa-fsuvk0
ownerRole: BACKEND
---

Починить tool-families: брать пресет из проекции agentPreset, а не из начального заголовка сессии, и пересчитывать ограничение при смене пресета. Добавить в scripts/tool-families-proof.mjs проверку жизненного цикла (создание под orchestrator, затем pre-step под backend → restrict с backend deny), перепаковать плагин и доказать.

Migrated from .dsh/taskboard.json (task task-mwkkohfa-fsuvk0, revision 10).
