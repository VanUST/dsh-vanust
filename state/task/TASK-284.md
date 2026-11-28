---
id: TASK-284
kind: task
title: "P1: пресет TESTER, запись только в кейсы/тесты, реалистичный red"
status: done
revision: 17
createdAt: 2026-11-22T11:39:15.416Z
updatedAt: 2026-11-22T19:42:15.129Z
acceptance:
  - text: "В профиле есть preset tester order 52; PRESET_IDS/ROLE_PRESETS принимают TESTER/QA; CRITIC больше не принимает tester/qa; delegate_task и каталог ролей видят TESTER; README/DEPLOYMENT/HARNESS-OVERVIEW/TERMINOLOGY/inventory/check-documentation согласованы"
    done: false
  - text: "DEFAULT_ROLE_TOOLS.tester полный набор case_*; README-таблица и policy-docs тест совпадают; KNOWN_PRESETS включает tester"
    done: false
  - text: "proof-guard для tester разрешает write/edit только docs/cases/** и тестовые корни, продуктовый файл отклоняет WRITE_SCOPE; тестовый файл по-прежнему требует PROOF; другие пресеты не изменились; тесты"
    done: false
  - text: "case_record требует failsWhen/trigger/oracle/realism для automated acceptance; case_get/gate возвращают; изменение сбрасывает подтверждение; тесты"
    done: false
  - text: "case_run redSource wrong-product: копия прошлой версии/неверная реализация, запись redFirst.source; exit 0 -> WRONG_PRODUCT_DID_NOT_FAIL; acceptance без wrong-product red -> NOT_WRONG_PRODUCT_RED; green после wrong-product -> verified; тесты и proof"
    done: false
  - text: "Политика оркестратора: десять ролей, порядок L2, L0/L1 лёгкие; тесты/проверки"
    done: false
  - text: "Все тесты, make test, make verify, proof зелёные; тарболы совпадают; живой профиль и :3080 не тронуты; P0-поведение не сломано"
    done: false
  - text: "Отчёт называет, что не проверено (живой пилот, установка профиля) и что осталось P2/B1'"
    done: false
  - text: "B1 закрыт: write/edit с docs/cases/../../src/app.mjs, test/../src, mixed separators, absolute и symlink не пишут продукт; путь нормализуется до сравнения области; тесты на обход"
    done: false
  - text: "W1 закрыт: wrong-product red в пустом/неверном дереве (команда не найдена, testPath отсутствует, head null) отклоняется WRONG_PRODUCT_TREE_INVALID; реальная копия прошлой версии принимается; negative-control не считается"
    done: false
  - text: "B1 residual: junction на продукт с несуществующими подкаталогами (`docs/cases/jlink/newdir/deep/helper.mjs`) не пишет продукт; resolveWithin идёт до ближайшего существующего предка и realpath-ит его; тест"
    done: false
  - text: "W1 substantive: red cwd вне рабочего каталога, байты теста в красном дереве совпадают с testHash, продуктовый surface-файл существует, red head != green head; заглушка внутри docs/cases, дерево без продукта, копия с тем же HEAD отклоняются; реальная копия прошлого коммита принимается; тесты"
    done: false
  - text: "D1: законный git clone предыдущей версии с core.autocrlf=true не даёт WRONG_PRODUCT_TEST_MISMATCH; сравнение теста нормализует CRLF или сравнивает git blob; изменённый тест по-прежнему отклоняется; тест"
    done: false
  - text: "D2: WRONG_PRODUCT_HEAD_NOT_PREVIOUS покрыт автотестом (клон с тем же HEAD), а не только кодом"
    done: false
  - text: "D3: дерево на другом диске не считается «внутри workspace»; проверка использует isAbsolute(relative(...)); тест или явная логика"
    done: false
  - text: "H2: root spec либо матчится (**/*.spec.* без обязательного слэша), либо явно задокументирован; H1 README исправлен"
    done: false
  - text: "B2/B3/shell названы границей; финальное ревью/атака подтверждают B1/W1; живой пилот на временном профиле выполнен или назван блокер"
    done: false
boardId: task-mwrrkv6d-7ii8t0
nonScope: ["P2: criterionId/покрытие критериев, task contract — отдельная задача", "journal/signature for B1/B1' — отдельная P1 hardening task, не смешивать с пилотом", "живой профиль ~/.npm/dsh/profiles/web, :3080, переустановка тарболов", "существующие docs/cases/*.json не переписывать; тесты на временных фикстурах", "P0-поведение и версии 0.1.27/0.1.74 ломать нельзя"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-189, REQ-190, REQ-191, REQ-194]
resultArtifacts: ["%TEMP%\\p1-pilot", plugins/test-cases/README.md, scripts/independent-verification-proof.mjs]
resultEvidence: ["proof 29/29 exit 0; test-cases 66/66; proof-guard 6/6; taskboard 37/37; make test 80/80; make verify 19/19", "independent REVIEWER accepted P1 and fix 3; CRITIC found B1/W1 and S4; B1/W1 fixed and re-attacked; S4 named B1 boundary in plugins/test-cases/README.md", "tarballs test-cases 0.1.32, proof-guard 0.1.4, orchestrator 0.1.65, taskboard 0.1.74 match tree", "temp profile: preset-tester in dump, server http://127.0.0.1:3081 HTTP 200; live :3080 401 untouched; profile mtime 09:47 no tester", "headless: MISSING_CREDENTIAL deepseek-official; kit patch on dsh-headless 12 entries did not activate", "analysis independent-verification rev 32: FR5/FR6/FR7/NFR2 deferred; BR1/FR8 planned for P2"]
resultSummary: "P1 implementation accepted: отдельный пресет TESTER (order 52), scoped write только в docs/cases/тестовые корни, обязательные failsWhen/trigger/oracle/realism, wrong-product red с реальным деревом, D1/D2/D3; B1/W1 закрыты после трёх независимых атак, S4/B2/B3/shell названы границами. Живой пилот на временном профиле собран (DSH_HOME, server 3081, preset-tester в dump, HTTP 200), но не выполнен: headless MISSING_CREDENTIAL, kit-пэтч на headless 12 entries; владелец 2026-11-22 выбрал отложить живой пилот. Pilot task-mwrsq5ge-yns4e4 blocked, общий профиль/:3080 не тронуты. Требования FR5/FR6/FR7/NFR2 переведены в deferred с причиной; P2 (BR1/FR8) — следующий шаг."
role: BACKEND
scope: ["profile/cordis.patch.yml: preset-tester order 52, persona, tools (shell, fs write/edit guarded, read/search, jobs, skills, compaction, todo, web? no present/PTC), tool-families tester row, proof-guard role config", "plugins/proof-guard/proof-guard.mjs + tests: role-aware write scope for tester (docs/cases/**, test/**, tests/**, **/*.test.*, **/*.spec.**); product path -> WRITE_SCOPE deny; test path still needs PROOF header; shell caveat documented", "plugins/orchestrator/orchestrator.mjs: PRESET_IDS + tester, ROLE_PRESETS tester/qa -> tester (critic keeps critic), policy text ten roles, delegate_task description, L2 order TESTER -> BACKEND -> TESTER -> REVIEWER/CRITIC; role catalog", "plugins/test-cases/test-cases.mjs: DEFAULT_ROLE_TOOLS.tester full case set; case_record failsWhen/trigger/oracle/realism for automated acceptance; case_get; gate evidence; case_update invalidation", "plugins/test-cases/lib/acceptance.mjs: acceptance requires wrong-product red, not only negative-control; evidence realism fields; reasons", "plugins/test-cases/lib/runner.mjs + bin/cases.mjs: case_run/case_suite redSource wrong-product, cwd copy, redFirst.source, WRONG_PRODUCT_DID_NOT_FAIL; CLI", "plugins/tool-families/tool-families.mjs config only: tester deny Playwright MCP/godot; no code semantics change", "README.md, rules/DEPLOYMENT.md, docs/HARNESS-OVERVIEW.md, docs/TERMINOLOGY.md, plugins/inventory.json, scripts/check-documentation.mjs if count/list; tests policy-docs/tool-families/orchestrator", "scripts/independent-verification-proof.mjs: P1 scenarios (TESTER preset present, write scope denied, realism required, wrong-product red accepted, negative-control not sufficient)", "package versions/tarballs: test-cases, taskboard if touched, proof-guard, orchestrator if touched; make verify"]
steps: ["Добавить preset tester в профиль, PRESET_IDS/ROLE_PRESETS, tool-families, DEFAULT_ROLE_TOOLS, политику и документацию", "Ограничить write/edit тестировщика кейсами и тестовыми путями через proof-guard", "Добавить failsWhen/trigger/oracle/realism в кейс приёмки и в evidence", "Добавить wrong-product red и требование его для acceptance case", "Прогнать тесты, make test, make verify, proof; перепаковать; не трогать живой профиль", "Fix B1: нормализовать путь до сравнения области (.., ., absolute, realpath), не пускать продуктовый файл; тесты", "Fix W1: wrong-product red требует реальное дерево прошлой версии/фикстуру (testPath существует, head известен, cwd != workspace); тесты", "Fix B1 residual: nearest existing ancestor + junction/new subdir", "Fix W1 substantive: cwd outside workspace, testHash, product surface, red head != green head", "Fix D1 CRLF clone, D2 HEAD_NOT_PREVIOUS test, D3 cross-drive inside", "H2 root spec и H1 README; финальное ревью/атака; живой пилот на временном профиле"]
stepsDone: 9
---

Реализовать P1 независимой проверки: отдельный пресет TESTER с ограниченной записью только в docs/cases и тестовые корни, полным набором case_*; обязательные failsWhen/trigger/oracle/realism у автоматического кейса приёмки; wrong-product red (прогон против прошлой версии/названной неверной реализации), который условие приёмки требует вместо одного negative-control; связать роль с оркестратором (каталог, политика, delegate_task, README/DEPLOYMENT/TERMINOLOGY/inventory) и доказать тестами. P0-поведение (0.1.27/0.1.74) не ломать; P2 и журнал/подпись B1/B1' не реализовывать; живой профиль и :3080 не трогать.
