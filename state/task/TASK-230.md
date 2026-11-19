---
id: TASK-230
kind: task
title: "P1: выход в чат, скрытие окон, без дубля Tasks"
status: done
revision: 4
createdAt: 2026-11-18T11:42:46.555Z
updatedAt: 2026-11-18T11:42:54.299Z
acceptance:
  - text: "В левой колонке нет Tasks; в шапке остался и открывает панель"
    done: false
  - text: "Back to chat возвращает в чат; скрытие левого и закрытие правого работают"
    done: false
  - text: "Скриншоты, axe 0, консоль чистая; make verify 17/17; :3080 не тронут"
    done: false
boardId: task-mwm1xztt-meew8o
owner:
  kind: agent
  label: UX/UI
  sessionId: 2a6b13b9-2d6a-4c35-b6d7-c4cedc7735ef
preset: ux
reqIds: [REQ-104, REQ-105, REQ-106, REQ-107]
resultEvidence: ["taskboard/client.js: 0 вхождений sidebar.panellist; TasksTrigger остался", "панель: Back to chat → selectPanel(null), toggleSidebar, sidebarRight.setExpanded(sessionId,false); браузер :3096: axe .ps-root 0, hit-targets <24px 0, 760px без переполнения, консоль/сеть 0; reports/u5/", "read-only: sha256 483 файлов state/ до/после совпали; make verify 17/17"]
resultSummary: "Панель состояния получила три кнопки: Back to chat (selectPanel(null)), Toggle left sidebar, Close right sidebar; дубль Tasks убран из левой колонки. Доказано в браузере на :3096 и скриншотами до/после."
role: UX/UI
scope: [plugins/taskboard/client.js, plugins/project-state-panel/client.js, "plugins/test-cases/client.js (только если нужен общий стиль кнопок)"]
sessions:
  - sessionId: 2a6b13b9-2d6a-4c35-b6d7-c4cedc7735ef
    label: UX/UI
    role: UX/UI
    status: sleeping
---

Убрать дубль Tasks из левой колонки (taskboard), добавить в шапку панели состояния Back to chat (selectPanel(null)), управление окнами (toggleSidebar, closeRightbar) и доказать в браузере на втором сервере.
