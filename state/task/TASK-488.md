---
id: TASK-488
kind: task
title: "Собрать батч: правила документации и панель"
status: active
revision: 2
createdAt: 2026-11-28T17:19:28.088Z
updatedAt: 2026-11-28T17:19:28.497Z
boardId: task-mx0odhmq-4w6szr
chore: true
choreReason: "Накопился батч: три правки политики оркестратора (документация проекта, пустой проект, отсутствующие файлы) и правки клиента панели — нужны пересборка и один перезапуск."
nonScope: ["Не перезапускать сервер и не запускать apply — шаг владельца.", "Не менять тексты политики по существу: только сборка и коммит."]
owner:
  kind: agent
  label: DEVOPS
  sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
preset: devops
role: DEVOPS
scope: [packages/, plugins/orchestrator/package.json, plugins/project-state-panel/package.json]
sessions:
  - sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
    label: DEVOPS
    role: DEVOPS
    status: active
---

Собери и закоммить батч так, чтобы один перезапуск владельца применил всё. Состав: (1) plugins/orchestrator/orchestrator.mjs — правило документации проекта (docs/GUIDE.md — навигация, docs/ARCHITECTURE.md — границы и владельцы, docs/TERMINOLOGY.md — слова, и эти три заводятся в проекте без документов до первой содержательной работы), правило для пустого проекта и правило про отсутствующие документы; (2) plugins/project-state-panel — правки клиента (одно чтение вместо двух, живой регион объявлений, axe 0 нарушений, контраст) и README; (3) кейсы и состояние. Сделай: подними версии orchestrator и project-state-panel, пересобери пакеты и удали прежние, закоммить, прогони make verify и приложи код, приложи план kit-update (только профиль и пакеты). Сервер не перезапускай.
