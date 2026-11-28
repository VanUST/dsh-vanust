---
id: TASK-511
kind: task
title: "Проверка после перезапуска: дрейф, версии, ключи плана"
status: done
revision: 5
createdAt: 2026-11-28T18:39:50.615Z
updatedAt: 2026-11-28T20:30:31.297Z
boardId: task-mx0r8uj4-adhikm
chore: true
choreReason: "После перезапуска надо подтвердить, что установленная сборка новая и что план в первом сообщении собирается новым генератором."
nonScope: ["Не менять код и тексты.", "Не трогать задачи и записи."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["kit-update --check --json: ok true, drift null, plan [], applied [], appliedHead = HEAD 87e304a, changedSinceApplied [] — дрейфа нет.", "Установлены: orchestrator 0.1.87, project-state 0.1.25, project-state-panel 0.1.53, state-feed 0.1.12, taskboard 0.1.99.", "state/plan.yaml перегенерирован после установки: initiativesWithOpenWork 31, initiativesListed 10, openTasksInJournal 6, openTasksListed 6; старых ключей нет.", "Сервер слушает порт 3080 (pid 53352, старт 21:38:57), plan.yaml mtime 21:39:54."]
resultSummary: "Перезапуск применил батч: дрейфа нет, пять пакетов установлены, план перегенерирован новым генератором с честными ключами; сервер слушает порт."
role: DEVOPS
---

Проверь, что перезапуск применил батч и что сгенерированный план собирается новым генератором. Сделай: (1) node scripts/kit-update.mjs --check --json и приложи вывод — дрейфа быть не должно; (2) назови установленные версии orchestrator, project-state, project-state-panel, state-feed, taskboard; (3) открой state/plan.yaml — если в нём всё ещё старые ключи initiatives/openTasks, значит виды не перегенерированы после установки: перегенерируй виды штатным путём состояния (regenerateViews) и покажи, что ключи стали initiativesWithOpenWork/initiativesListed/openTasksInJournal/openTasksListed; (4) приложи коды. Верни: дрейф, версии, ключи до и после, коды.
