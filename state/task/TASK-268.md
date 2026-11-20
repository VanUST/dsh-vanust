---
id: TASK-268
kind: task
title: "Роль ARCHITECT: маршрут по умолчанию gpt-6.2-sol вместо gpt-6.2-astra"
status: active
revision: 4
createdAt: 2026-11-20T14:19:15.388Z
updatedAt: 2026-11-20T14:20:00.233Z
boardId: task-mwp2exdp-0kchm3
chore: true
choreReason: "Указание владельца 2026-11-20: маршрут роли ARCHITECT по умолчанию — gpt-6.2-sol вместо gpt-6.2-astra. Отдельного REQ под это нет: REQ-141 описывает прежнее решение (astra) и уже rejected, поэтому задача ведётся как изменение конфигурации с записью требования в кейсы."
nonScope: ["Не перезапускать :3080 и не трогать ~/.npm/dsh", "Не менять список моделей openai-codex и каталог провайдера", "Не менять фолбэк deepseek-flash/max и правило выбора модели человеком"]
owner:
  kind: agent
  label: BACKEND
  sessionId: c60bde55-478b-40ae-aab9-c3c5c91c039e
preset: backend
role: BACKEND
scope: ["profile/cordis.patch.yml — строка flash-guard allowedRoutes и правило role-model для роли architect", "README.md, USERGUIDE.md, rules/DEPLOYMENT.md — упоминания маршрута по умолчанию", "docs/cases/ — запись требования владельца"]
sessions:
  - sessionId: c60bde55-478b-40ae-aab9-c3c5c91c039e
    label: BACKEND
    role: BACKEND
    status: active
---

Перевести маршрут роли ARCHITECT по умолчанию с openai-codex/gpt-6.2-astra на openai-codex/gpt-6.2-sol во всех местах, где он объявлен: правило role-model для роли architect и строка flash-guard allowedRoutes (иначе сторож откажет каждому делегированному architect-ребёнку). Обновить документацию, которая называет прежний маршрут. Фолбэк deepseek-flash/max и правило «явный выбор человеком не перезаписывается» не меняются. Проверить, что в конфигурации не осталось astra как маршрута по умолчанию и что make verify остаётся зелёным.
