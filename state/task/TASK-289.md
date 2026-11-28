---
id: TASK-289
kind: task
title: "P1 fix 2: целевое ревью W1 head/test и B1 junction"
status: done
revision: 5
createdAt: 2026-11-22T12:06:31.911Z
updatedAt: 2026-11-28T10:48:08.565Z
acceptance:
  - text: "Все команды перезапущены; вывод/коды"
    done: false
  - text: "B1 residual и W1 head/test/product подтверждены или опровергнуты"
    done: false
  - text: "WRONG_PRODUCT_HEAD_NOT_PREVIOUS/TEST_MISMATCH наблюдаемы в тесте или назван пробел"
    done: false
  - text: "P0 не сломан; живой профиль/:3080 не тронуты"
    done: false
boardId: task-mwrsjxt2-gfgbxq
nonScope: ["не править код, тесты, README, docs/cases", "не трогать живой профиль/:3080", "не реализовывать P2/журнал"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
reqIds: [REQ-189, REQ-190, REQ-191, REQ-194]
role: REVIEWER
scope: ["plugins/proof-guard/proof-guard.mjs + test/write-scope.test.mjs", "plugins/test-cases/test-cases.mjs, lib/acceptance.mjs, tests/fixtures", scripts/independent-verification-proof.mjs, plugins/test-cases/README.md]
---

Целевое ревью P1 fix 2: B1 residual (junction + несуществующие подкаталоги) и W1 substantive (red cwd вне workspace, testHash, product surface, red head != green head). Проверь, что `WRONG_PRODUCT_HEAD_NOT_PREVIOUS` и `WRONG_PRODUCT_TEST_MISMATCH` реально наблюдаются, а не только есть в коде; что `testPath` не может быть единственным surface-файлом; что P0 не сломан; живой профиль/:3080 не тронуты. B2/B3/shell — названные границы.
