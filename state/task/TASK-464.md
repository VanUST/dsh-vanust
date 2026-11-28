---
id: TASK-464
kind: task
title: "Закоммитить переход на rc.5 и сопутствующий батч"
status: active
revision: 2
createdAt: 2026-11-28T14:25:49.339Z
updatedAt: 2026-11-28T14:25:49.586Z
boardId: task-mx0i66fr-57ck9r
chore: true
choreReason: "Батч изменений (переход на rc.5, решения в плане, единый пин, приёмка границ) лежит в рабочем дереве; до перезапуска его надо сохранить в истории."
nonScope: ["Не перезапускать сервер, не запускать kit-update --apply: это шаг владельца.", "Не менять код, кроме уже принятого."]
owner:
  kind: agent
  label: DEVOPS
  sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
preset: devops
role: DEVOPS
scope: [packages/, state/, docs/cases/]
sessions:
  - sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
    label: DEVOPS
    role: DEVOPS
    status: active
---

Закоммить батч, который сейчас лежит в рабочем дереве, и приведи пакеты в соответствие. Состав: переход на харнесс 0.2.2-rc.5 (пин в install.ps1 и документах, install.sh выводит его, profile/cordis.patch.yml с явным searchProvider), решения в плане (state/decision/DEC-001..003, state/plan.yaml, views), единый источник пина (install.ps1, install.sh, scripts/check-documentation.mjs, тест), независимая приёмка границ (docs/cases + драйвер), правка scripts/delegation-basis-proof.mjs. Проверь, что пакет project-state 0.1.23 включает принятый views.mjs, пересобери при расхождении, затем git add осмысленных файлов, коммит с описанием и прогон make verify (код возврата приложи). Не перезапускай сервер и не запускай apply.
