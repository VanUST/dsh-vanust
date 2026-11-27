---
id: TASK-366
kind: task
title: "Закоммитить и запушить правила обёртки и фиксы плагинов"
status: active
revision: 2
createdAt: 2026-11-27T16:28:09.944Z
updatedAt: 2026-11-27T16:28:10.681Z
boardId: task-mwz73myv-9rrp5x
chore: true
choreReason: "Доставка готовой работы сессии в origin по просьбе владельца."
nonScope: ["Не коммитить .dsh/, reports/, node_modules, .babysitter.", "Не перезаписывать историю и не удалять файлы, кроме уже удалённой сборки 0.1.89 (её удаление входит в коммит).", "Не устанавливать сборки и не перезапускать сервер."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 518246e7-dc3c-4527-8ca6-40ecf225b943
preset: backend
role: BACKEND
scope: [/tmp/push/]
sessions:
  - sessionId: 518246e7-dc3c-4527-8ca6-40ecf225b943
    label: BACKEND
    role: BACKEND
    status: active
---

Закоммитить и запушить работу этой сессии: правила обёртки (один владелец порта, строка launch, антиштормовое окно), плагины taskboard 0.1.89 и project-state 0.1.19 с их сборками и исправленной версией, обновлённый журнал проекта. Доказать, что удалённый HEAD совпал с локальным.
