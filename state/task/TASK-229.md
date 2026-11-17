---
id: TASK-229
kind: task
title: "V6.2: pack-plugin не должен удалять тарболы соседних плагинов по общему префиксу"
status: open
revision: 1
createdAt: 2026-11-17T16:52:08.738Z
updatedAt: 2026-11-17T16:52:08.738Z
boardId: task-mwkxi0pu-5i0626
---

Устранить причину, по которой тарбол панели исчезает при перепаковке ядра: в `scripts/pack-plugin.mjs` очистка чужих версий сравнивает имена по префиксу `cc-dsh-project-state-`, и под него попадает `cc-dsh-project-state-panel-*.tgz`. Требовать цифру версии после префикса, как уже сделано в проверке переносимости, перепаковать панель и вернуть `make verify` в зелёный.

Migrated from .dsh/taskboard.json (task task-mwkxi0pu-5i0626, revision 1).
