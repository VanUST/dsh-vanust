---
id: TASK-417
kind: task
title: "Ревью требований, задач, кейсов и карты дизайна"
status: done
revision: 4
createdAt: 2026-11-28T10:45:35.883Z
updatedAt: 2026-11-28T10:52:45.270Z
acceptance:
  - text: "Показать владельцев данных, механизм архитектурных отказов, жизненный цикл брифа и цели, фактический повторный запуск специалистов; подкрепить file:line."
    done: false
boardId: task-mx0aaygo-jdbj02
chore: true
choreReason: "Ревью существующего агентского воркфлоу без реализации."
nonScope: ["Не менять код и данные проекта, требования и дизайн карты; не трогать развёртывание."]
owner:
  kind: agent
  label: CONTEXT
preset: gatherer
resultEvidence: ["plugins/analysis/store.mjs:1740–1783,1823–1927; plugins/analysis/analysis.mjs:399–431 — условия запуска, закрытия задачи и цели.", "plugins/orchestrator/orchestrator.mjs:1260–1344; plugins/delegation-brief/index.mjs:114–169,191–199 — бриф задачи, повторное использование специалиста и отдельная проверка ответа по требованию.", "docs/DESIGNMAP-V2.md:3–25; map_list — одна пустая страница system; plugins/analysis/mirror.mjs:126–179 и plugins/test-cases/test-cases.mjs:569–603 — два уровня проверки доказательств.", "Наблюдение: первое закрытие задачи DEVOPS отказано (TASK_JOURNAL_MISMATCH); plugins/taskboard/lib/journal.mjs:28–35,55–68,80–97 и plugins/taskboard/taskboard.mjs:2075–2096,2155–2239,2429–2455."]
resultSummary: "Разделены требования, доказательства кейсов, ход задач, карта дизайна и цель. Подтверждены два пути брифа и отказ закрытия после штатного завершения специалиста; проверка записи анализа не проверяет соответствие кода архитектуре. Проверки предложено назначать по риску, не по количеству задач."
role: CONTEXT
---

Проследить требования до решения о дизайне, задач, кейсов и закрытия работы; найти, что система действительно удерживает между чатами.
