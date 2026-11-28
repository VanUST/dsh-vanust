---
id: TASK-513
kind: task
title: "Приёмка вкладки плана: независимый кейс"
status: done
revision: 15
createdAt: 2026-11-28T20:28:48.640Z
updatedAt: 2026-11-28T21:06:53.067Z
boardId: task-mx0v4zhe-1xk8rl
nonScope: ["Не менять client.js, views.mjs, feed.mjs.", "Не трогать сервер и развёртывание."]
owner:
  kind: agent
  label: TESTER
preset: tester
reqId: REQ-309
reqIds: [REQ-309]
resultEvidence: ["Зелёный: docs/cases/drivers/plan-tab-acceptance.mjs exit 0 — одно чтение state/views/plan.md, 0 команд, секции инициатив/решений/задач, DEC-004 > DEC-003, axe 0 нарушений, ArrowRight переключает вкладку и фокус.", "Красный на worktree aa7d65f (до 7b86a55): exit 1, десять именованных провалов, включая color-contrast.", "Кейс the-plan-tab-shows-the-long-term-plan-in-one-read-names-an-e: purpose acceptance, verified rev 5; прогоны red mx0vqgt5-482xb-1 и green mx0vqmiu-wepwc-1."]
resultSummary: "Приёмка вкладки плана состоялась независимо: зелёный на текущем дереве, десять именованных провалов на дереве до 7b86a55, кейс записан как acceptance и verified."
role: TESTER
scope: [docs/cases/]
---

Напиши независимый кейс приёмки на вкладку плана в панели состояния и измерь его. Требование: владелец видит долгосрочный план в интерфейсе, а не только в файле — инициативы с незавершённой работой, решения свежими первыми, открытые задачи; при открытии одно чтение state/views/plan.md и ноль команд; пустой и отсутствующий план названы словами; axe без нарушений; клавиатура переключает вкладки. Сделай: (1) драйвер и тест под docs/cases/drivers, монтирующий настоящий client.js на настоящем state/views/plan.md; (2) красный прогон на копии дерева до коммита 7b86a55 (там вкладки нет) — приложи код и вывод; (3) зелёный на текущем дереве — приложи код, число чтений, счётчики строк, результат axe; (4) запиши кейс с purpose acceptance, criterionId и redFirst, чтобы он мог закрыть требование. Верни: кейс, оба прогона с кодами, что не проверено.
