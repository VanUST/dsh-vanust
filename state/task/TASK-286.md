---
id: TASK-286
kind: task
title: "R1: готовность новой экосистемы — флаг IPv4 и второй сервер"
status: done
revision: 1
createdAt: 2026-11-23T08:44:02.372Z
updatedAt: 2026-11-23T08:44:02.372Z
boardId: task-mwm1c0me-0r7f5k
---

Доказать, что новая экосистема готова к перезапуску: закрепить в start.sh флаг --dns-result-order=ipv4first (без него Node-fetch с этой машины уходит в IPv6 без маршрута и падает, хотя curl работает), развернуть копию профиля через kit-update --apply и поднять второй сервер на :3095, проверив состав: session-budget отсутствует, openai-codex с актуальными моделями, панель 0.1.16, orchestrator 0.1.57.

Migrated from .dsh/taskboard.json (task task-mwm1c0me-0r7f5k, revision 3).
