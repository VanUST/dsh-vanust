---
id: TASK-358
kind: task
title: "Что растёт в autolabel_pipeline: состояние, логи сессий, стоимость хода"
status: active
revision: 2
createdAt: 2026-11-27T15:57:19.554Z
updatedAt: 2026-11-27T15:57:20.336Z
boardId: task-mwz5zzca-y1wgw3
chore: true
choreReason: "Диагностика: почему именно в проекте autolabel_pipeline со временем растёт число процессов и CPU."
nonScope: ["Не менять файлы проекта autolabel_pipeline.", "Не запускать его сервер и не открывать сессии.", "Не трогать агентов защиты."]
owner:
  kind: agent
  label: DEVOPS
  sessionId: b9d8076f-2838-4f02-926c-3d4cb835b755
preset: devops
role: DEVOPS
scope: [/tmp/autolabel-dsh/]
sessions:
  - sessionId: b9d8076f-2838-4f02-926c-3d4cb835b755
    label: DEVOPS
    role: DEVOPS
    status: active
---

Найти, что растёт в проекте autolabel_pipeline и даёт нагрузку: размеры его состояния (.dsh/, taskboard, state/events, views), размеры и число логов сессий, пишется ли лог простаивающей сессии (mtime/size за 60 с), сколько у него плагинов/MCP и во сколько обходится один ход. Сравнить с dsh-kit по числам и назвать механизм, из-за которого «спустя время» становится тяжело.
