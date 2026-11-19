---
id: TASK-107
kind: task
title: "Проверка роли BACKEND после отката PTC"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.356Z
updatedAt: 2026-11-17T15:52:40.356Z
acceptance:
  - text: "одна команда выполнена, её вывод приведён дословно"
    done: false
  - text: "ни один файл в workspace не изменён"
    done: false
boardId: task-mwdmywit-xxoudl
nonScope: ["не менять файлы, не создавать задач, не делегировать дальше", "не трогать git и серверы"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 7c4be27d-fc12-43dd-a9c2-280c31780b0c
ownerRole: BACKEND
preset: backend
resultEvidence: ["Ребёнок выполнил bash: echo backend-ok; uname -s → 'backend-ok' / 'Linux', exit code 0", "Последний request/header его сессии: 77 инструментов, bash присутствует, run_code отсутствует — откат PTC действует", "У сессии 0 неуспешных assistant/attempt после рестарта (прежний INVALID_REQUEST defer_loading больше не воспроизводится)"]
resultSummary: "Живая проверка после рестарта: роль BACKEND снова работает в native-режиме. Прямой bash-вызов выполнен (echo backend-ok; uname -s → backend-ok / Linux, exit 0), в заголовке запроса 77 инструментов с bash и без run_code, неуспешных попыток в сессии нет. Откат PTC подтверждён на живой роли."
role: BACKEND
scope: ["одна команда оболочки"]
sessions:
  - sessionId: 7c4be27d-fc12-43dd-a9c2-280c31780b0c
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Минимальная проверка живости роли BACKEND после рестарта с откатом PTC: выполнить одну простую команду оболочки (например `echo backend-ok` или `uname -s`) и дословно вернуть её вывод. Ничего не читать и не менять сверх этого.

Migrated from .dsh/taskboard.json (task task-mwdmywit-xxoudl, revision 6).
