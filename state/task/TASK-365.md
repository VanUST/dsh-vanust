---
id: TASK-365
kind: task
title: "Исправить версию project-state: 0.1.89 → 0.1.19"
status: done
revision: 6
createdAt: 2026-11-27T16:26:04.814Z
updatedAt: 2026-11-27T16:28:24.972Z
boardId: task-mwz70yez-0cghcx
chore: true
choreReason: "Исправление номера версии плагина перед установкой: 0.1.89 вместо 0.1.19 ломает последовательность версий кита."
nonScope: ["Не менять код плагинов и taskboard.", "Не устанавливать сборки, не перезапускать сервер."]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["`grep -n '\"version\"' plugins/project-state/package.json` → 0.1.19; pack-plugin --version 0.1.19 → sha256 01c3504a…, PACK_EXIT=0.", "Payload побайтно равен исходникам: lib/core.mjs 26cdeda1…, index.mjs 0b0ecaab…, lib/views.mjs 23bd1d9d….", "Прежний артефакт удалён: `ls plugins/cc-dsh-project-state-0.1.89.tgz` → No such file; остался 0.1.19 (33 073 Б).", "taskboard 0.1.89 не тронут (29e0af8c…); профиль и сервер не менялись."]
resultSummary: "Версия project-state исправлена: 0.1.89 → 0.1.19, артефакт пересобран (sha256 01c3504a…), payload равен исходникам, прежний 0.1.89 удалён, taskboard и профиль не тронуты."
role: BACKEND
scope: [plugins/project-state/, plugins/cc-dsh-project-state-0.1.19.tgz, /tmp/state-cost/]
---

Вернуть правильную последовательность версий: project-state 0.1.89 → 0.1.19 в package.json, пересобрать артефакт, удалить прежний, доказать побайтное совпадение payload с исходниками.
