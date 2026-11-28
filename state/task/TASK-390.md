---
id: TASK-390
kind: task
title: "T1: поверхность инструментов — удалить мёртвое, вернуть designmap, включить godot-deny и outline"
status: done
revision: 1
createdAt: 2026-11-23T08:44:01.859Z
updatedAt: 2026-11-23T08:44:01.859Z
boardId: task-mwly4vbt-p3tfw4
ownerRole: BACKEND
---

Привести поверхность инструментов в соответствие с замером: удалить `presentation`; убрать из allow-листов мёртвые имена (`case_suite` у backend, `taskboard`, `schedule_*`, `ratchet_*`, `read_mcp_resource`, `list_mcp_resource_templates`); добавить недостающие `designmap_export` и `designmap_lint`; включить `projectDeny` для godot по `project.godot`; и — отдельным фокусом — сделать `outline` реально доступным и используемым: он не установлен в живом профиле, поэтому ноль вызовов, а это инструмент, который должен заменять чтение целого файла. После правки повторить замер по журналам и сравнить с первым аудитом.

Migrated from .dsh/taskboard.json (task task-mwly4vbt-p3tfw4, revision 8).
