---
id: TASK-415
kind: task
title: "Ревью границ DSH kit и зависимости от харнесса"
status: done
revision: 4
createdAt: 2026-11-28T10:45:34.893Z
updatedAt: 2026-11-28T10:52:44.454Z
acceptance:
  - text: "Версия и привязки к харнессу, порядок загрузки и обновления, владельцы и направление зависимостей; находки с file:line, наблюдения отделены от выводов."
    done: false
boardId: task-mx0aaygm-n19t0t
chore: true
choreReason: "Ревью существующей архитектуры без реализации."
nonScope: ["Не менять код и файлы проекта; не трогать развёртывание."]
owner:
  kind: agent
  label: CONTEXT
preset: gatherer
resultEvidence: ["docs/GUIDE.md:15–42; scripts/kit-update.mjs:374–443,988–1022,1147–1187; scripts/harness-identity-guard.mjs:1–51.", "plugins/project-state/lib/core.mjs:480–497,743–786; владельцы связей в plugins/taskboard/mirror.mjs:29–56, plugins/analysis/mirror.mjs:15–35 и plugins/test-cases/mirror.mjs:29–56.", "node scripts/kit-update.mjs --check --json: exit 0, drift=null, plan=[], harness=0.2.2-rc.3. Процесс :3080 запущен из установленного дерева после последнего применения; версию из памяти процесса не читали."]
resultSummary: "Границы проверены по исходникам, установленной сборке и наблюдению процесса. Харнесс владеет сессией, набором инструментов на шаге и запросом; DSH kit — составом пресетов и правилами работы; отдельные плагины владеют требованиями, задачами и кейсами. Правки установленных пакетов — отдельная зависимость от версии, не обычные плагины."
role: CONTEXT
---

Проверить владельцев подсистем, реальные связи и зависимость от установленного харнесса.
