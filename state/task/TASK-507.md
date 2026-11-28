---
id: TASK-507
kind: task
title: "Кейс ворот: перепривязать и подтвердить прогоном"
status: blocked
revision: 5
createdAt: 2026-11-28T18:11:59.658Z
updatedAt: 2026-11-28T18:27:50.795Z
boardId: task-mx0q91gp-oueq23
chore: true
choreReason: "Кейс, записанный этой ролью, остался failing: тест правился после записи, перепривязать может только автор."
nonScope: ["Не трогать другие кейсы.", "Не менять поведение ворот."]
owner:
  kind: agent
  label: BACKEND
preset: backend
role: BACKEND
scope: [docs/cases/]
---

Верни в строй кейс a-delegation-that-declares-architectureimpact-is-refused-unt, который ты записал. Сейчас он failing: тест plugins/orchestrator/test/architect-consult-gate.test.mjs правился после записи (хеш e7c61f17 → b5a62d97), а прогон отказывает TEST_CHANGED; не-автору кейс править нельзя. Сделай: (1) перепривяжи кейс к текущему тесту (case_update с testPath, expectedRevision 3); (2) прогони зелёный прогон и приложи код; (3) если при прогоне что-то не сходится — назови расхождение, а не подгоняй ожидание под тест. Верни: статус кейса, код прогона, что осталось.
