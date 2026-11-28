---
id: TASK-285
kind: task
title: "P1: независимое ревью пресета TESTER и реалистичного red"
status: done
revision: 5
createdAt: 2026-11-22T11:49:38.664Z
updatedAt: 2026-11-22T11:58:37.092Z
acceptance:
  - text: "Все заявленные команды перезапущены, вывод/коды приложены; расхождения названы"
    done: false
  - text: "Пресет TESTER, mapping, tool-families, scoped write, реализм и wrong-product red подтверждены на собственных фикстурах"
    done: false
  - text: "P0-поведение не сломано; живой профиль/:3080 не тронуты; P2/журнал не реализованы"
    done: false
  - text: "Временный smoke-пилот выполнен или назван точный блокер и минимальный план живого пилота"
    done: false
  - text: "Вердикт: принято или дефекты с severity/file:line/репродукцией"
    done: false
boardId: task-mwrry7yr-yxfwfg
nonScope: ["не править код, тесты, README, docs/cases", "не трогать живой профиль ~/.npm/dsh/profiles/web и :3080", "не реализовывать P2/журнал/подпись", "не переписывать существующие кейсы"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
reqIds: [REQ-189, REQ-190, REQ-191, REQ-194]
resultEvidence: ["node scripts/independent-verification-proof.mjs -> 27/27 exit 0", "test-cases 66/66; taskboard 37/37; proof-guard 4/4; orchestrator 13/13; make test 80/80; make verify 19/19", "tarballs test-cases 0.1.28, proof-guard 0.1.2, orchestrator 0.1.65, taskboard 0.1.74 byte-identical", "realism: FAILS_WHEN_REQUIRED; wrong-product: WRONG_PRODUCT_DID_NOT_FAIL in passing tree; negative-control only -> NOT_WRONG_PRODUCT_RED", "guard: tester product WRITE_SCOPE; case allow; test without PROOF denied; backend unchanged", "live profile mtime 09:47, no preset-tester; live agent pilot not run", "H1 README line 231 fixed by orchestrator; H2 root spec mismatch; B-shell named"]
resultSummary: "Независимое ревью P1: принято с H1/H2 и границей B-shell. Пресет TESTER (order 52), mapping QA/TESTER, tool-families, scoped write, обязательные realism-поля и wrong-product red подтверждены на собственных фикстурах; P0 не сломан (proof 27/27, test-cases 66/66, taskboard 37/37, make test 80/80, make verify 19/19 + 11 пресетов). Живой агентский пилот не выполнен: нужен второй профиль/сервер/провайдер; назван точный блокер и план 2–3 задач. H1 README-противоречие исправлено оркестратором; H2 root spec — косметика/политика; shell — названная граница."
role: REVIEWER
scope: ["profile/cordis.patch.yml (preset-tester, families.tester, proof-guard roles, budget)", "plugins/proof-guard/**", "plugins/orchestrator/**", "plugins/test-cases/**", "plugins/tool-families config (profile only)", "README.md, rules/DEPLOYMENT.md, docs/HARNESS-OVERVIEW.md, docs/TERMINOLOGY.md, plugins/inventory.json, scripts/check-documentation.mjs", scripts/independent-verification-proof.mjs, "tests/proof scripts"]
---

Независимо проверить P1: пресет TESTER (order 52, десять ролей, mapping QA/TESTER, tool-families, scoped write, DEFAULT_ROLE_TOOLS, KNOWN_PRESETS), proof-guard WRITE_SCOPE, обязательные failsWhen/trigger/oracle/realism, wrong-product red, политику оркестратора и документацию. Перезапусти все заявленные команды. Проверь, что P0-поведение 0.1.27/0.1.74 не сломано и живой профиль/:3080 не тронуты. Если можешь поднять временный профиль/CLI с source-патчем без живого профиля — сделай минимальный smoke-пилот TESTER; если нет — назови точный блокер и что осталось для живого пилота.
