---
id: TASK-106
kind: task
title: "Живая проверка PTC и проекции run_code после рестарта"
status: cancelled
revision: 2
createdAt: 2026-11-17T15:52:40.340Z
updatedAt: 2026-11-17T15:52:40.340Z
acceptance:
  - text: "в ответе процитирована команда/вызов и наблюдаемый размер вывода"
    done: false
  - text: "указано, каким инструментом ты выполнял программу (имя инструмента из твоего набора), и был ли это run_code"
    done: false
  - text: "не создано и не изменено ни одного файла в workspace"
    done: false
boardId: task-mwdmsvsa-8l2eje
nonScope: ["не менять файлы в workspace", "не создавать задач и не делегировать дальше", "не трогать git и не перезапускать серверы"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 7c4be27d-fc12-43dd-a9c2-280c31780b0c
ownerRole: BACKEND
preset: backend
role: BACKEND
scope: ["одна программа, печатающая ~12 000 символов", "чтение своего результата"]
sessions:
  - sessionId: 7c4be27d-fc12-43dd-a9c2-280c31780b0c
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Проверить живую конфигурацию после рестарта: выполнить одну программу, печатающую около 12 000 символов детерминированного текста, и отчитаться наблюдаемым результатом — каким инструментом выполнялась программа (ожидается run_code, режим PTC) и что вернулось в ответе: полный текст или проекция с баннером и путём к spill-файлу.

Migrated from .dsh/taskboard.json (task task-mwdmsvsa-8l2eje, revision 6).
