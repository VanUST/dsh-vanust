---
id: TASK-291
kind: task
title: "P1 fix 3: целевое ревью D1/D2/D3"
status: done
revision: 5
createdAt: 2026-11-22T12:11:21.707Z
updatedAt: 2026-11-22T19:57:20.730Z
acceptance:
  - text: "D1/D2/D3 подтверждены или опровергнуты; вывод/коды"
    done: false
  - text: "S4 назван границей B1, не закрыт"
    done: false
  - text: "P0 не сломан; живой профиль/:3080 не тронуты"
    done: false
  - text: "Вердикт"
    done: false
boardId: task-mwrsq5aq-0h21aq
nonScope: ["не править код/тесты/README/docs/cases", "не трогать живой профиль/:3080", "не реализовывать P2/журнал", "не чинить S4"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
reqIds: [REQ-189, REQ-190, REQ-191, REQ-194]
resultEvidence: ["test-cases 66/66; realism-and-wrong-product 3/3; proof 29/29; make test 80/80; make verify 19/19", "autocrlf clone previous -> accepted; same head -> WRONG_PRODUCT_HEAD_NOT_PREVIOUS; edited test -> TEST_MISMATCH", "textHash CRLF->LF; raw testHash still binds executed bytes", "isAbsolute(relative(C:ws,D:clone)) -> D:\\clone, flaggedAsInside false", "README:135-139 names S4 as B1 forgery boundary, no acceptance condition", "P0 manual unverified, TEST_CHANGED; live profile/:3080 untouched"]
resultSummary: "Целевое ревью fix 3: принято. D1 textHash CRLF→LF, autocrlf clone предыдущей версии принимается, same-head → HEAD_NOT_PREVIOUS, изменённый тест → TEST_MISMATCH; D2 тест есть; D3 isAbsolute(relative) — логика верна, портативной фикстуры нет; S4 остаётся названной границей B1 в README, не закрыт. P0 не сломан; test-cases 66/66, proof 29/29, make test 80/80, make verify 19/19; тарбол 0.1.32 совпадает; живой профиль/:3080 не тронуты."
role: REVIEWER
scope: [plugins/test-cases/lib/schema.mjs, plugins/test-cases/test-cases.mjs, plugins/test-cases/test/realism-and-wrong-product.test.mjs, plugins/test-cases/README.md, scripts/independent-verification-proof.mjs]
---

Целевое ревью P1 fix 3: D1 (textHash нормализует CRLF, autocrlf clone принимается, изменённый тест отклоняется), D2 (автотест WRONG_PRODUCT_HEAD_NOT_PREVIOUS), D3 (isAbsolute(relative) для другого диска). Проверь, что S4 остаётся названной границей B1 и не выдан за закрытый; P0 не сломан; живой профиль/:3080 не тронуты. Не редактируй.
