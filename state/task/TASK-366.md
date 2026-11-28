---
id: TASK-366
kind: task
title: "Закоммитить и запушить правила обёртки и фиксы плагинов"
status: done
revision: 6
createdAt: 2026-11-27T16:28:09.944Z
updatedAt: 2026-11-27T16:32:56.129Z
boardId: task-mwz73myv-9rrp5x
chore: true
choreReason: "Доставка готовой работы сессии в origin по просьбе владельца."
nonScope: ["Не коммитить .dsh/, reports/, node_modules, .babysitter.", "Не перезаписывать историю и не удалять файлы, кроме уже удалённой сборки 0.1.89 (её удаление входит в коммит).", "Не устанавливать сборки и не перезапускать сервер."]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["Коммит 8453cf6 «Wrapper launcher rules and plugin cost fixes» (родитель f40b957), 35 файлов по явным путям, commit_exit=0.", "Пуш через setsid nohup: v1 exit=0 (HTTP/1.1); независимая перепроверка `git ls-remote origin refs/heads/main` → 8453cf69c880501fc480921cd655cc94a40e865d = git rev-parse HEAD.", "Состав: M scripts/dsh-wrapper.sh, M plugins/taskboard/taskboard.mjs, M plugins/project-state/lib/core.mjs, M package.json обоих, D 0.1.88/0.1.18 → A 0.1.89/0.1.19, M docs/analysis/client-load-performance.json, M state/* (35 файлов, +706/−108).", "Запретное не попало: grep по `.dsh/|reports/|node_modules|.babysitter/` → пусто; git status --porcelain пуст."]
resultSummary: "Работа сессии запушена: коммит 8453cf6 (35 файлов, +706/−108) — правила обёртки, taskboard 0.1.89 и project-state 0.1.19 со сборками и версиями, журнал и запись анализа. origin/main = 8453cf69c880501fc480921cd655cc94a40e865d = локальный HEAD, проверено отдельным ls-remote; дерево чистое, запретные пути не попали."
role: BACKEND
scope: [/tmp/push/]
---

Закоммитить и запушить работу этой сессии: правила обёртки (один владелец порта, строка launch, антиштормовое окно), плагины taskboard 0.1.89 и project-state 0.1.19 с их сборками и исправленной версией, обновлённый журнал проекта. Доказать, что удалённый HEAD совпал с локальным.
