---
id: TASK-422
kind: task
title: "Собрать и прогнать проверки перед обновлением харнесса"
status: done
revision: 7
createdAt: 2026-11-28T11:04:54.388Z
updatedAt: 2026-11-28T11:11:31.891Z
acceptance:
  - text: "Для закреплённой версии есть версии, точные команды и выводы по доступным проверкам; непроверенные участки явно названы; проверку можно повторить на кандидате."
    done: false
boardId: task-mx0azs60-p6jl77
chore: true
choreReason: "Проверить наблюдаемые зависимости на закреплённой версии без обновления рабочей установки."
nonScope: ["Не менять рабочий сервер, установленное окружение и пользовательские сессии; не обновлять версию и не отключать патчи в рабочей установке."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultArtifacts: [docs/HARNESS-UPGRADE-CHECKS.md]
resultEvidence: ["node scripts/kit-update.mjs --check --json → exit 0, harness 0.2.2-rc.3, drift:null, plan:[], head=appliedHead=4237e82b…", "node scripts/harness-identity-guard.mjs --probe --json → exit 0, probe.load:true, probe.write:true; исполнен установленный модуль в отдельном процессе", "node scripts/check-preset-configs.mjs → exit 0, 147 строк проверены, 1 без схемы, 0 отказов", "docs/HARNESS-UPGRADE-CHECKS.md §2–4: команды, вывод, границы доказательств и протокол повторения."]
resultSummary: "Подготовлен протокол проверки установленного харнесса; исходники и установленный пакет проверены без изменения работающего развёртывания."
role: DEVOPS
scope: [docs/HARNESS-UPGRADE-CHECKS.md]
---

Оставить набор повторяемых проверок границы кита с харнессом и измерить закреплённую версию в изоляции.
