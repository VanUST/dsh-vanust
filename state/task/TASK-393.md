---
id: TASK-393
kind: task
title: "U4: State в верхнюю панель и адаптивная светлая/тёмная тема"
status: done
revision: 1
createdAt: 2026-11-23T08:44:02.062Z
updatedAt: 2026-11-23T08:44:02.062Z
boardId: task-mwlzqosl-t56z93
ownerRole: UX/UI
---

Перенести точку входа панели состояния из левой колонки в верхнюю панель и сделать панель адаптивной к светлой и тёмной теме оболочки. Верхняя панель: найти живой слот (conversation.session.header* или shell.leading) и зарегистрировать State там, убрав из sidebar.panellist. Тема: заменить тёмные хардкоды Night desk на токены --dsw-alias-* с светлым и тёмным вариантом, сохранив семантические акценты сущностей и рельс доказательства. Доказать в браузере на втором сервере скриншотами обеих тем, чистым axe и консолью; не трогать :3080.

Migrated from .dsh/taskboard.json (task task-mwlzqosl-t56z93, revision 8).
