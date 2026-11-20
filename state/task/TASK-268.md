---
id: TASK-268
kind: task
title: "Роль ARCHITECT: маршрут по умолчанию gpt-6.2-sol вместо gpt-6.2-astra"
status: done
revision: 6
createdAt: 2026-11-20T14:19:15.388Z
updatedAt: 2026-11-20T14:25:53.958Z
boardId: task-mwp2exdp-0kchm3
chore: true
choreReason: "Указание владельца 2026-11-20: маршрут роли ARCHITECT по умолчанию — gpt-6.2-sol вместо gpt-6.2-astra. Отдельного REQ под это нет: REQ-141 описывает прежнее решение (astra) и уже rejected, поэтому задача ведётся как изменение конфигурации с записью требования в кейсы."
nonScope: ["Не перезапускать :3080 и не трогать ~/.npm/dsh", "Не менять список моделей openai-codex и каталог провайдера", "Не менять фолбэк deepseek-flash/max и правило выбора модели человеком"]
owner:
  kind: agent
  label: BACKEND
  sessionId: c60bde55-478b-40ae-aab9-c3c5c91c039e
preset: backend
resultEvidence: ["git show HEAD:profile/cordis.patch.yml | grep 'model: gpt-6.2-sol' -> строки 288 (flash-guard allowedRoutes) и 1047 (role-model architect)", "grep 'model: gpt-6.2-astra' profile/cordis.patch.yml -> нет совпадений; astra осталась только как `- id: gpt-6.2-astra` в каталоге провайдера", "make verify -> exit 0, 19/19, оба негативных контроля", "node --test plugins/role-model/test/role-model.test.mjs -> 16/16; dsh-migration-proof 11/11", "кейс the-architect-role-defaults-to-gpt-6-2-sol: source human, unverified, linkedTaskId task-mwp2exdp-0kchm3"]
resultSummary: "Маршрут роли ARCHITECT по умолчанию переведён с openai-codex/gpt-6.2-astra на openai-codex/gpt-6.2-sol в двух местах профиля (правило role-model и строка flash-guard allowedRoutes, иначе сторож отказал бы каждому architect-ребёнку) и в трёх документах. Фолбэк deepseek-flash/max и правило «явный выбор человеком не перезаписывается» не тронуты; astra осталась только в каталоге провайдера. Требование владельца записано кейсом, живой сервер получит новую пару при следующей сходимости."
role: BACKEND
scope: ["profile/cordis.patch.yml — строка flash-guard allowedRoutes и правило role-model для роли architect", "README.md, USERGUIDE.md, rules/DEPLOYMENT.md — упоминания маршрута по умолчанию", "docs/cases/ — запись требования владельца"]
sessions:
  - sessionId: c60bde55-478b-40ae-aab9-c3c5c91c039e
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Перевести маршрут роли ARCHITECT по умолчанию с openai-codex/gpt-6.2-astra на openai-codex/gpt-6.2-sol во всех местах, где он объявлен: правило role-model для роли architect и строка flash-guard allowedRoutes (иначе сторож откажет каждому делегированному architect-ребёнку). Обновить документацию, которая называет прежний маршрут. Фолбэк deepseek-flash/max и правило «явный выбор человеком не перезаписывается» не меняются. Проверить, что в конфигурации не осталось astra как маршрута по умолчанию и что make verify остаётся зелёным.
