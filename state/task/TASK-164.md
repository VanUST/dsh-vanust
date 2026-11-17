---
id: TASK-164
kind: task
title: "Повтор запроса после MALFORMED_RESPONSE: ход не должен падать"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.288Z
updatedAt: 2026-11-17T15:52:41.288Z
boardId: task-mwkh6334-358zg6
---

Ответ модели с невалидным JSON аргументов инструмента (`MALFORMED_RESPONSE`, сообщение `tool input is invalid JSON`) сейчас завершает ход: политика повтора маршрута DeepSeek по умолчанию перечисляет только EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT и TRANSPORT. Владелец просит, чтобы агент не останавливался из-за такого ответа. Изменить политику повтора маршрута в патче профиля kit-а, доказав красным и зелёным прогоном на фейковом провайдере, что ход переживает такой ответ.

Migrated from .dsh/taskboard.json (task task-mwkh6334-358zg6, revision 4).
