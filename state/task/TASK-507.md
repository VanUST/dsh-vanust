---
id: TASK-507
kind: task
title: "Кейс ворот: перепривязать и подтвердить прогоном"
status: done
revision: 9
createdAt: 2026-11-28T18:11:59.658Z
updatedAt: 2026-11-28T18:40:50.494Z
boardId: task-mx0q91gp-oueq23
chore: true
choreReason: "Кейс, записанный этой ролью, остался failing: тест правился после записи, перепривязать может только автор."
nonScope: ["Не трогать другие кейсы.", "Не менять поведение ворот."]
owner:
  kind: agent
  label: BACKEND
  sessionId: 03bf75aa-207a-4b54-8bae-a12a0ca51e90
preset: backend
resultEvidence: ["case_update доступен после перезапуска: кейс перепривязан к plugins/orchestrator/test/architect-consult-gate.test.mjs, revision 4, testHash b5a62d97…", "Красный контроль expect-pre-fix: run mx0r99zc-hjzvo-1, exit 1, redFirst записан.", "Зелёный прогон: run mx0r9es1-hmqks-1, exit 0, pass 8 fail 0, duration 167 ms; кейс status verified, revision 6.", "Продукт не менялся: orchestrator.mjs sha256 e2b0f90e… совпадает с surfaceFiles кейса."]
resultSummary: "Кейс ворот вернулся в строй: перепривязан к текущему тесту, красный контроль и зелёный прогон записаны, статус verified — а значит case_update действительно появился в роли после перезапуска."
role: BACKEND
scope: [docs/cases/]
sessions:
  - sessionId: 03bf75aa-207a-4b54-8bae-a12a0ca51e90
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Верни в строй кейс a-delegation-that-declares-architectureimpact-is-refused-unt, который ты записал. Сейчас он failing: тест plugins/orchestrator/test/architect-consult-gate.test.mjs правился после записи (хеш e7c61f17 → b5a62d97), а прогон отказывает TEST_CHANGED; не-автору кейс править нельзя. Сделай: (1) перепривяжи кейс к текущему тесту (case_update с testPath, expectedRevision 3); (2) прогони зелёный прогон и приложи код; (3) если при прогоне что-то не сходится — назови расхождение, а не подгоняй ожидание под тест. Верни: статус кейса, код прогона, что осталось.
