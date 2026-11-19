---
id: TASK-231
kind: task
title: "P1-T: red→green тест навигации панелей"
status: done
revision: 5
createdAt: 2026-11-18T12:00:26.400Z
updatedAt: 2026-11-18T12:05:59.062Z
acceptance:
  - text: "Тест падает (exit != 0) на версиях до правки и проходит (exit 0) на текущих файлах; красный и зелёный прогоны записаны"
    done: false
  - text: "Тест проверяет: в taskboard/client.js нет sidebar.panellist; в панели есть Back to chat, toggleSidebar и сброс правой колонки (setExpanded ... false)"
    done: false
  - text: "Кейс записан с testPath + runCommand + checks и связан с задачей"
    done: false
  - text: "make verify 17/17; живой :3080 не тронут"
    done: false
boardId: task-mwm2kpm4-q7lbqq
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
preset: backend
reqIds: [REQ-104, REQ-105, REQ-106, REQ-107]
resultEvidence: ["plugins/taskboard/test/panel-navigation.test.mjs: зелёный exit 0; на /tmp/p1-before (git HEAD) — exit 1 с пятью нарушениями", "четыре кейса REQ-104…107 с linkedTaskId и прогонами red→green: exit 1/violations 2 → exit 0/0, все verified", "make verify 17/17"]
resultSummary: "Сделано красное/зелёное доказательство для P1: статический тест на инварианты навигации, красный на версиях до правки; на каждое из четырёх REQ записан и верифицирован кейс."
role: BACKEND
scope: ["scripts/ или plugins/*/test/ для нового теста", "plugins/taskboard/client.js и plugins/project-state-panel/client.js — только чтение", case_record/case_run]
sessions:
  - sessionId: d31aa145-06d5-4c8a-a605-590193af752c
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Дать формальное red→green доказательство для правки P1: тест, который на версиях до правки падает (в taskboard есть sidebar.panellist, в панели нет Back/toggle/close), а на текущих файлах проходит. Записать кейс с exact runCommand и парой красный→зелёный.
