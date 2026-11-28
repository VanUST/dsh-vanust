---
id: TASK-464
kind: task
title: "Закоммитить переход на rc.5 и сопутствующий батч"
status: done
revision: 5
createdAt: 2026-11-28T14:25:49.339Z
updatedAt: 2026-11-28T14:41:28.373Z
boardId: task-mx0i66fr-57ck9r
chore: true
choreReason: "Батч изменений (переход на rc.5, решения в плане, единый пин, приёмка границ) лежит в рабочем дереве; до перезапуска его надо сохранить в истории."
nonScope: ["Не перезапускать сервер, не запускать kit-update --apply: это шаг владельца.", "Не менять код, кроме уже принятого."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит 712033e: 55 файлов, +1775/−209; git status без незакоммиченных изменений, посторонние неотслеживаемые файлы не включены.", "Пакет project-state 0.1.23 содержит принятый views.mjs: sha256 исходника и файла из tgz совпадают (b5d6e5c3…), версия в tgz 0.1.23; пересборка не требовалась.", "make verify на закоммиченном дереве: exit 0 — 20/20 portability (tarball:matches-source PASS), boundaries gate ok, documentation ok с новыми проверками пина, schema-lint 0 red, preset-configs 0 refused, identity-guard patched.", "Сервер не перезапускался, kit-update --apply не запускался."]
resultSummary: "Батч закоммичен (712033e): переход на 0.2.2-rc.5, единый пин, решения в плане, независимая приёмка границ; пакет 0.1.23 содержит принятый исходник, make verify зелёный."
role: DEVOPS
scope: [packages/, state/, docs/cases/]
---

Закоммить батч, который сейчас лежит в рабочем дереве, и приведи пакеты в соответствие. Состав: переход на харнесс 0.2.2-rc.5 (пин в install.ps1 и документах, install.sh выводит его, profile/cordis.patch.yml с явным searchProvider), решения в плане (state/decision/DEC-001..003, state/plan.yaml, views), единый источник пина (install.ps1, install.sh, scripts/check-documentation.mjs, тест), независимая приёмка границ (docs/cases + драйвер), правка scripts/delegation-basis-proof.mjs. Проверь, что пакет project-state 0.1.23 включает принятый views.mjs, пересобери при расхождении, затем git add осмысленных файлов, коммит с описанием и прогон make verify (код возврата приложи). Не перезапускай сервер и не запускай apply.
