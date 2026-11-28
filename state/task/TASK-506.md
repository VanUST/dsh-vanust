---
id: TASK-506
kind: task
title: "Кейсы ворот: свести два следа к одному живому"
status: done
revision: 4
createdAt: 2026-11-28T18:11:24.214Z
updatedAt: 2026-11-28T18:13:45.390Z
boardId: task-mx0q89zv-vd8a5o
chore: true
choreReason: "В библиотеке кейсов остались два следа TEST_CHANGED после правки ворот, один помечен failing: их надо привести в согласие с кодом или снять как дубликат."
nonScope: ["Не переписывать формулировки требований.", "Не трогать другие кейсы библиотеки."]
owner:
  kind: agent
  label: TESTER
  sessionId: e3081072-4b62-40c3-857f-01ec790401ac
preset: tester
resultEvidence: ["Дубликат an-l2-delegation-with-architectureimpact-is-refused-until-th переведён в superseded (rev 4) со ссылкой на живой кейс и причиной: формулировка про L2 устарела, правило теперь по флагу.", "Тест plugins/orchestrator/test/architect-consult-gate.test.mjs прогнан заново: 8/8, exit 0 — прежнее падение было следствием правки теста во время прогона.", "Живой кейс оставлен: a-delegation-that-declares-architectureimpact-is-refused-unt; его перепривязка к новому тесту требует автора (AUTHOR_ONLY) — отдельная задача."]
resultSummary: "Библиотека сведена к одному живому кейсу: дубликат с формулировкой про L2 снят как superseded, тест ворот прогнан 8/8, перепривязка живого кейса отдана его автору."
role: TESTER
scope: [docs/cases/]
sessions:
  - sessionId: e3081072-4b62-40c3-857f-01ec790401ac
    label: TESTER
    role: TESTER
    status: sleeping
---

Приведи в порядок два кейса, которые разошлись с кодом после правки ворот архитектурной консультации. (1) a-delegation-that-declares-architectureimpact-is-refused-unt — помечен failing, последний прогон упал (exit 1), потому что тест правился во время прогона; прогони его заново и, если он зелёный, зафиксируй это. (2) an-l2-delegation-with-architectureimpact-is-refused-until-th — помечен TEST_CHANGED, и его заголовок с ожиданием говорят про класс L2, а правило теперь по флагу architectureImpact: перепиши ожидание под действующее правило или сними как дубликат первого. Оба кейса защищают одно и то же поведение — своди их к одному живому, второй снимай явно. Верни: что стало с каждым (статус, прогон, код) и какой остался живым.
