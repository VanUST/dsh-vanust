---
id: TASK-447
kind: task
title: "Коммит и установка: шов, вид плана, правила документации"
status: done
revision: 5
createdAt: 2026-11-28T13:26:00.455Z
updatedAt: 2026-11-28T13:35:30.983Z
boardId: task-mx0g199u-pfkgzv
chore: true
choreReason: "Доставка трёх принятых изменений на развёртывание одним обновлением: шов в оркестраторе, вид плана в состоянии проекта, новые правила документации."
nonScope: ["Не менять код и документы; только коммит, установка и перезапуск."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит ab3a67f: 81 файл, orchestrator 0.1.83, project-state 0.1.21, пакеты и удаления прежних; state/events и .dsh/ не включены.", "После ручного старта: kit-update --check --json → exit 0, drift null, plan [], server running.", "Версии в профиле: @cc/dsh-orchestrator 0.1.83, @cc/dsh-project-state 0.1.21, @cc/dsh-taskboard 0.1.98.", "Живая проверка: субагент DOCS запущен через шов и вернул ответ; задача закрыта без дополнительного сохранения."]
resultSummary: "Изменения доставлены: оркестратор 0.1.83 со швом, состояние проекта 0.1.21 с видом плана, правила документации. drift null, версии в профиле совпадают, живой запуск субагента через шов проходит."
role: DEVOPS
scope: [.dsh/deploy.log]
---

Закоммить и доставь принятые изменения одним обновлением. Коммит: plugins/orchestrator (0.1.83, шов), plugins/project-state (0.1.21, вид плана), пакеты cc-dsh-orchestrator-0.1.83.tgz и cc-dsh-project-state-0.1.21.tgz с удалением прежних, scripts/check-documentation.mjs с тестом, scripts/check-prompt-playbooks.mjs и scripts/audit-preset-composition.mjs (только комментарии), docs/ARCHITECTURE.md, GUIDE.md, TERMINOLOGY.md, rules/DEPLOYMENT.md, README.md, profile/cordis.patch.yml, docs/analysis/, docs/cases/, state/views/. Не включать state/events и .dsh/. Затем: остановить сервер, node scripts/kit-update.mjs --apply, поднять через C:\Users\1\.dsh\bin\dsh.ps1 web --port 3080, дождаться HTTP, записать .dsh/post-check.json и версии @cc/dsh-orchestrator, @cc/dsh-project-state, @cc/dsh-taskboard из profiles/web/node_modules в .dsh/deploy.log. Перезапуск — последним действием, отдельным процессом через планировщик заданий, как в прошлый раз; после запуска не жди результата.
