---
id: TASK-436
kind: task
title: "Вынести форму запуска субагента в шов харнесса"
status: done
revision: 6
createdAt: 2026-11-28T12:59:32.334Z
updatedAt: 2026-11-28T13:04:40.016Z
boardId: task-mx0f37sm-hivhcz
nonScope: ["Другие вызовы харнесса (сессии, события, инструменты) не оборачивать: шов только на запуске субагента, пока нет второй формы. Пакет не собирать и не устанавливать: установка — отдельным шагом после приёмки."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-296]
resultEvidence: ["TEST-109 rev 5: красный mx0f8u4f-q0320-1 на клоне git HEAD 88e42df (exit 1) и зелёный mx0f8xvi-40kh6-1 (exit 0).", "Проверка кода: в orchestrator.mjs один вызов шва (строка 1343), маркеров spec.request, maxDepth, outputSchema нет; harness-seam.mjs содержит ACTIVATION_FORMS и явный отказ на неизвестной форме.", "Хеши: harness-seam.mjs 072B1586, orchestrator.mjs 90A16D0C, docs/HARNESS-CONTRACT.md 36817C30, драйвер EB9D8381.", "Прогоны исполнителя: шов 3/3, оркестратор 49/49, ворот 10/10, migration proof 11/11, check-documentation ok."]
resultSummary: "Форма запуска субагента вынесена в plugins/orchestrator/harness-seam.mjs: обе известные формы собираются в одном месте, оркестратор передаёт только факты делегирования, неизвестная форма — явный отказ. Принято по кейсу TEST-109 с красным на git HEAD."
role: BACKEND
scope: [plugins/orchestrator/orchestrator.mjs, plugins/orchestrator/harness-seam.mjs, plugins/orchestrator/test/, plugins/orchestrator/package.json, docs/HARNESS-CONTRACT.md]
---

Вынеси знание о форме запуска субагента из оркестратора в один модуль, чтобы переход на следующую версию харнесса правил один файл. Сейчас обе формы (spec.request.* для 0.2.1 и плоская spec.parent.id для 0.2.2) собираются функцией внутри orchestrator.mjs; комментарий там же объясняет, почему шлются обе. Нужно: новый модуль plugins/orchestrator/harness-seam.mjs с функцией, которая по входу (роль, пресет, промпт, родитель, маршрут, каталог, сигнал) отдаёт готовый объект активации, и единственным местом, где перечислены обе формы; оркестратор вызывает его и больше не содержит полей формы; тест модуля проверяет обе формы на одном входе и то, что оркестратор их не собирает; docs/HARNESS-CONTRACT.md перечисляет вызовы харнесса с владельцем и способом проверки. Докажи неизменность поведения: прогони тесты оркестратора и один реальный запуск субагента через инструмент (короткая задача роли DOCS), покажи, что ребёнок стартовал и вернулся.
