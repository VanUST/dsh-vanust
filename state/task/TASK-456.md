---
id: TASK-456
kind: task
title: "Включить проверку границ в штатные гейты"
status: done
revision: 4
createdAt: 2026-11-28T13:50:25.845Z
updatedAt: 2026-11-28T13:53:10.174Z
boardId: task-mx0gwo79-kutto7
chore: true
choreReason: "Проверка границ уже ловит нарушения, но её тест не видит штатный гейт — тот же класс дефекта, что был у теста документации."
nonScope: ["Не менять правила проверки и список исключений; только место теста и шаг гейта."]
owner:
  kind: agent
  label: BACKEND
  sessionId: bbf8a2f9-cb8d-4d64-82c6-867feafd3695
preset: backend
reqIds: [REQ-301]
resultEvidence: ["scripts/check-boundaries.test.mjs → scripts/test/check-boundaries.test.mjs; импорт на ../check-boundaries.mjs.", "Makefile:142 — node scripts/check-boundaries.mjs --check в цели verify; test-all --list: 89 шагов, новый тест присутствует.", "make test ONLY=check-boundaries → 5/5 зелёные, exit 0.", "На копии чистого дерева (HEAD + три файла) make verify → VERIFY_EXIT=0, шаг границ печатает gate ok."]
resultSummary: "Проверка границ включена в штатные гейты: тест выбирается раннером (89 шагов), шаг --check стоит в make verify, на чистом дереве verify зелёный."
role: BACKEND
scope: [scripts/check-boundaries.test.mjs, scripts/test/, Makefile]
sessions:
  - sessionId: bbf8a2f9-cb8d-4d64-82c6-867feafd3695
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Включи проверку границ в штатные гейты. Сейчас scripts/check-boundaries.test.mjs лежит вне scripts/test/, поэтому make test его не выбирает, а make verify его не запускает — то есть проверка держится на ручном прогоне. Перенеси тест в scripts/test/ (как уже сделано с тестом документации), поправь пути импорта и добавь шаг «проверка границ» в make verify рядом с остальными проверками. Докажи: scripts/test-all.mjs --list содержит новый тест, make test его прогоняет и он зелёный, make verify зелёный и содержит шаг проверки границ; назови коды возврата.
