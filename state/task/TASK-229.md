---
id: TASK-229
kind: task
title: "V6.2: pack-plugin не должен удалять тарболы соседних плагинов по общему префиксу"
status: done
revision: 3
createdAt: 2026-11-17T16:52:08.738Z
updatedAt: 2026-11-17T16:52:08.738Z
acceptance:
  - text: "Условие удаления чужих тарболов требует цифру версии после префикса, поэтому `project-state` больше не удаляет `project-state-panel`"
    done: false
  - text: "Перепаковка ядра больше не убирает тарбол панели; `make verify` exit 0"
    done: false
  - text: "Перепакованы все затронутые тарболы; инвентарь сходится с диском"
    done: false
boardId: task-mwkxi0pu-5i0626
inline: true
nonScope: ["менять формат имён тарболов и инвентарь", "трогать панель и designmap"]
resultEvidence: ["scripts/pack-plugin.mjs: условие удаления чужих тарболов требует цифру версии после префикса (регэксп)", "перепаковка ядра удалила только свой старый 0.1.8 и оставила cc-dsh-project-state-panel-0.1.8.tgz", "make verify → exit 0 (17/17)"]
resultSummary: "Устранена причина исчезновения тарбола панели: упаковка ядра удаляла соседний плагин, потому что «cc-dsh-project-state» — префикс «cc-dsh-project-state-panel». Очистка чужих версий теперь требует цифру версии после префикса; перепаковано и проверено."
---

Устранить причину, по которой тарбол панели исчезает при перепаковке ядра: в `scripts/pack-plugin.mjs` очистка чужих версий сравнивает имена по префиксу `cc-dsh-project-state-`, и под него попадает `cc-dsh-project-state-panel-*.tgz`. Требовать цифру версии после префикса, как уже сделано в проверке переносимости, перепаковать панель и вернуть `make verify` в зелёный.

Migrated from .dsh/taskboard.json (task task-mwkxi0pu-5i0626, revision 1).
