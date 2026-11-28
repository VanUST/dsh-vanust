---
id: TASK-448
kind: task
title: "Убрать задачу автоперезапуска и снять проверку установки"
status: done
revision: 5
createdAt: 2026-11-28T13:34:03.627Z
updatedAt: 2026-11-28T13:53:20.203Z
boardId: task-mx0gbm9e-3iqfn0
chore: true
choreReason: "После установки осталась зарегистрированная задача планировщика с триггером на 23:59, а сервер поднял владелец вручную; нужно убрать задачу и снять машинную проверку."
nonScope: ["Не перезапускать сервер и не менять профиль; только проверка, удаление задачи и запись факта в лог."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["schtasks /Delete dsh-restart-ab3a67f → SUCCESS exit 0; /Query → exit 1; в списке задач совпадений dsh-restart нет.", "node scripts/kit-update.mjs --check --json → exit 0, drift null, plan [], server running.", "Версии: @cc/dsh-orchestrator 0.1.83, @cc/dsh-project-state 0.1.21, @cc/dsh-taskboard 0.1.98.", "В .dsh/deploy.log добавлена строка с фактами инцидента и ручного старта."]
resultSummary: "Задача автоперезапуска удалена, машинная проверка снята: drift null, план пуст, версии в профиле совпадают с принятыми."
role: DEVOPS
scope: [.dsh/deploy.log]
---

Убери следы неудавшегося автоперезапуска и сними машинную проверку после ручного старта. Сделай: (1) удали задачу планировщика dsh-restart-ab3a67f (schtasks /Delete /TN dsh-restart-ab3a67f /F) и докажи, что её больше нет в списке; (2) прогони node scripts/kit-update.mjs --check --json и приложи drift и plan — ожидается null и пустой план; (3) запиши в .dsh/deploy.log строку: авто-драйвер остановил сервер и запустил apply в 16:27:51, но не поднял его; apply завершился (версии 0.1.83 и 0.1.21 установлены), сервер поднят владельцем вручную; задача удалена; (4) назови версии @cc/dsh-orchestrator, @cc/dsh-project-state, @cc/dsh-taskboard из profiles/web/node_modules. Сервер не перезапускай.
