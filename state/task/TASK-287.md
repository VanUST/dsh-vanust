---
id: TASK-287
kind: task
title: "P1 fix: целевое ревью B1/W1/H2"
status: done
revision: 5
createdAt: 2026-11-22T11:58:35.117Z
updatedAt: 2026-11-22T12:06:33.485Z
acceptance:
  - text: "Все команды перезапущены, вывод/коды приложены"
    done: false
  - text: "B1/W1/H2 подтверждены на собственных фикстурах или опровергнуты"
    done: false
  - text: "P0 не сломан; живой профиль/:3080 не тронуты; B2/B3/shell названы"
    done: false
  - text: "Вердикт: принято или дефекты с severity/file:line/репродукцией"
    done: false
boardId: task-mwrs9pwz-khfarj
nonScope: ["не править код, тесты, README, docs/cases", "не трогать живой профиль/:3080", "не реализовывать P2/журнал"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
reqIds: [REQ-189, REQ-190, REQ-191, REQ-194]
resultEvidence: ["proof 29/29; test-cases 66/66; proof-guard 5/5; taskboard 37/37; make test 80/80; make verify 19/19", "B1 fixtures: docs/cases/../../src, test/../src, ../../../outside, mixed, absolute product, symlink tests/link -> src all WRITE_SCOPE; legit tests/ and docs/cases allowed", "H2 root x.spec.mjs/x.test.mjs with PROOF allowed", "W1: no cwd/workspace/empty/non-git -> WRONG_PRODUCT_TREE_INVALID; real git copy -> red cwd/head, green verified", "negative-control only -> NOT_WRONG_PRODUCT_RED; P0 manual/self-run/TEST_CHANGED still blocked", "tarballs 0.1.30/0.1.3 match; live profile/:3080 untouched"]
resultSummary: "Целевое ревью P1-фикса: принято. B1/W1/H2 подтверждены на собственных фикстурах: `docs/cases/../../src` и mixed/absolute/symlink — WRITE_SCOPE; root spec/test матчатся; wrong-product red без cwd/с рабочим cwd/в пустом/не-git дереве — WRONG_PRODUCT_TREE_INVALID, реальная git-копия принимается; negative-control только -> NOT_WRONG_PRODUCT_RED. P0 не сломан; proof 29/29, test-cases 66/66, proof-guard 5/5, taskboard 37/37, make test 80/80, make verify 19/19; тарболы 0.1.30/0.1.3. Остаточная граница: red.head не сравнивается с head зелёного прогона; B2/B3/shell/подделка/realism-only named."
role: REVIEWER
scope: ["plugins/proof-guard/proof-guard.mjs + test/write-scope.test.mjs", "plugins/test-cases/test-cases.mjs, lib/acceptance.mjs, lib/runner.mjs, tests", scripts/independent-verification-proof.mjs, "plugins/test-cases/README.md, scripts/check-portability.mjs"]
---

Целевое ревью P1 после B1/W1/H2. Проверь, что относительный `..` больше не пишет продукт, absolute/realpath/mixed separators не обходят область, тест под тестовым корнем разрешён, wrong-product red требует реальное дерево с testPath и git head, пустой каталог/команда не найдена отклоняются, H2 root spec матчится. P0-поведение не сломано; живой профиль/:3080 не тронуты; B2/B3/shell — названные границы. Отчёт исполнителя — утверждение.
