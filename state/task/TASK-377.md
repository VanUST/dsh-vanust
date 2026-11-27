---
id: TASK-377
kind: task
title: "Закоммитить и запушить всю работу сессии"
status: active
revision: 4
createdAt: 2026-11-27T18:07:52.636Z
updatedAt: 2026-11-27T18:17:56.665Z
boardId: task-mwzanw7d-3daxvf
nonScope: ["Не переписывать историю: без rebase, force-push и amend.", "Не устанавливать сборки и не перезапускать сервер."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 92878f18-48d0-4b9d-a788-0c3a12d51957
preset: backend
reqIds: [REQ-280]
role: BACKEND
scope: [/tmp/push/]
sessions:
  - sessionId: 92878f18-48d0-4b9d-a788-0c3a12d51957
    label: BACKEND
    role: BACKEND
    status: active
---

Закоммитить и запушить всю работу сессии одним осмысленным коммитом (или двумя по областям, если так чище): правила обёртки, доска на журнале и снимке, проекция строк панели, task_batch, state-feed без лишних чтений, ленивый sdk_api без режима «покажи всё», сборки и журнал. Доказать совпадение удалённого HEAD с локальным.
