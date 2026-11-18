---
id: TASK-232
kind: task
title: "P2: правая колонка панели, верхняя панель без Tasks и Design map"
status: active
revision: 2
createdAt: 2026-11-18T12:26:55.696Z
updatedAt: 2026-11-18T12:27:05.889Z
boardId: task-mwm3irxo-x6slzr
reqIds: [REQ-108, REQ-109, REQ-110]
steps: ["Правая колонка: состояние railOpen, кнопка скрывает/возвращает ps-rail, aria-pressed и подпись", "taskboard: удалить регистрацию TasksTrigger, оставить main", "designmap: удалить регистрацию HeaderTrigger из entry.jsx и пересобрать client.js", "Обновить panel-navigation.test.mjs под новую форму", "Красный прогон на HEAD → зелёный на текущих; записать 3 кейса, перепрогнать 4 старых", "Пересобрать 3 тарбола с проверкой соседей и make verify"]
stepsDone: 0
---

Панель состояния получает рабочую кнопку правой колонки: нажатие убирает колонку доказательств, повторное — возвращает, кнопка отражает состояние (aria-pressed, подпись). Верхняя панель сессии перестаёт показывать старые входы: из клиента taskboard удаляется регистрация TasksTrigger в conversation.session.header.actions, из клиента designmap — HeaderTrigger «Design map»; обе панели остаются зарегистрированными в main. Статический тест panel-navigation.test.mjs обновляется под новую форму, для каждого требования записывается кейс с парой красный→зелёный, старые четыре кейса перепрогоняются, три тарбола пересобираются, make verify — 17/17.
