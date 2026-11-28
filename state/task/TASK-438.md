---
id: TASK-438
kind: task
title: "Приёмка шва харнесса: обе формы и отсутствие формы в оркестраторе"
status: review
revision: 3
createdAt: 2026-11-28T13:02:39.177Z
updatedAt: 2026-11-28T13:04:09.448Z
boardId: task-mx0f7811-uqvohi
nonScope: ["Не пересобирать пакет и не устанавливать; не менять harness-seam.mjs и orchestrator.mjs; не трогать работающее развёртывание."]
owner:
  kind: agent
  label: TESTER
  sessionId: e3081072-4b62-40c3-857f-01ec790401ac
preset: tester
reqIds: [REQ-296]
role: TESTER
scope: [docs/cases/, test/harness-seam-acceptance.test.mjs]
sessions:
  - sessionId: e3081072-4b62-40c3-857f-01ec790401ac
    label: TESTER
    role: TESTER
    status: sleeping
---

Дай независимую приёмку шва харнесса. Нужен один кейс приёмки с драйвером test/harness-seam-acceptance.test.mjs, который проверяет три вещи: (1) на одном входе шов отдаёт обе формы сразу, и каждая форма читается своим читателем (spec.request.parent.id для прежней и spec.parent.id для текущей); (2) форма выбирается по имени, а неизвестная даёт явный отказ, а не тихий откат; (3) в plugins/orchestrator/orchestrator.mjs нет полей формы активации — они живут только в шве, а docs/HARNESS-CONTRACT.md перечисляет вызовы. Красный прогон — на клоне git HEAD 88e42df: там форма собирается внутри оркестратора, поэтому проверка (3) обязана упасть. Зелёный — на текущем дереве. Верни по одному результату на REQ-296-C01, REQ-296-C02, REQ-296-C03.
