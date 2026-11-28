---
id: TASK-392
kind: task
title: "B2: адаптер OpenAI/Codex в харнессе, выбор модели и вход внешнего агента"
status: done
revision: 1
createdAt: 2026-11-23T08:44:02.003Z
updatedAt: 2026-11-23T08:44:02.003Z
boardId: task-mwlzqnkb-yrhh0t
ownerRole: BACKEND
---

Открыть харнесс для модели OpenAI/Codex: новый хост-плагин адаптера против ctx.llm (registerAdapter + registerConfigurableProviders), который стримит ответы и умеет tool-calls, читает ключ из credentials и отдаёт список моделей через discovery. Плюс выбрать модель под роль: для системного дизайнера/бизнес-аналитика — рассуждающую, для кода — кодовую, с id из /v1/models. И ответить на вопрос про API-поверхность: каким существующим путём DSH (acp, sdk-app, api-gateway) внешний Codex/ChatGPT-агент ведёт сессию, с точными шагами; новый мост — только если ни один путь не подходит.

Migrated from .dsh/taskboard.json (task task-mwlzqnkb-yrhh0t, revision 7).
