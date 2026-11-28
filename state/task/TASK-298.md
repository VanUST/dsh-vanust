---
id: TASK-298
kind: task
title: "Закрыть остаточные риски P0/P1/P2 и пакетного ревью"
status: done
revision: 25
createdAt: 2026-11-22T20:14:50.030Z
updatedAt: 2026-11-22T20:53:06.211Z
acceptance:
  - text: "case_update unknown/status refused with code; test"
    done: false
  - text: "task_update params/whitelist sync test; reviewResults without reviewedTaskIds covered"
    done: false
  - text: "taskboard suite stable under parallel load; root cause fixed or test isolated"
    done: false
  - text: "hard link and product *.test.* outside tests -> WRITE_SCOPE; tests/ allowed; tests"
    done: false
  - text: "shell product change detected and blocks case gate/task close; documented as detection, not sandbox"
    done: false
  - text: "independent acceptance requires realism sign-off; S4 human boundary documented"
    done: false
  - text: "journal hash-chain detects hand edit of case/row; tamper-evident; tests"
    done: false
  - text: "make test/make verify/proof green; live profile/:3080 untouched; docs/cases untouched; versions/tarballs"
    done: false
boardId: task-mws9zwaa-ontgwx
nonScope: ["живой профиль ~/.npm/dsh/profiles/web и :3080; установка профиля", "P1 pilot/P2 task contract/batch review — не откатывать", "docs/cases существующие кейсы не переписывать; миграция только чтение", "не выдавать shell audit/journal за песочницу или криптоподпись", "не пушить; push — отдельная задача после закрытия"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-196]
resultEvidence: ["make test 87/87; make verify 19/19; proof 29/29; taskboard 56/56; proof-guard 11/11", "third reviewer PASS: D5 close from orchestrator -> product_shell_violation; D4 profile docs/cases,test,tests only and product test name WRITE_SCOPE; LOW two-way parity, reqId absent", "case/task journal: hand edit -> CASE/TASK_JOURNAL_MISMATCH; legacy readable/closes; board-lock EPERM fix; flake-probe 6/6", "taskboard 0.1.84, proof-guard 0.1.8, test-cases 0.1.35; live profile mtime 09:47, docs/cases clean", "risk-closure analysis rev 10 complete, FR1 deferred; no push"]
resultSummary: "Все семь остаточных рисков закрыты или сведены к названной проверяемой границе. Закрыты: case_update unknown/status (CASE_FIELD_UNKNOWN), task_update parameters/whitelist parity + reviewResults без batch, hard link/B3 (WRITE_SCOPE, только docs/cases/, test/, tests/), realism sign-off (self -> REALISM_SIGNOFF_SELF; independent требует подпись), shell audit (детектор, product_shell_violation по всем сессиям строки; D5), case journal и task journal (tamper-evident, legacy, CASE/TASK_JOURNAL_MISMATCH), board-lock flake (EPERM/EACCES как конкуренция; flake-probe), D4 (profile roots, регрессионный тест), LOW (reqId убран, двусторонний паритет). Три ревьювера: PASS после D5/D4/low. make test 87/87, make verify 19/19, proof 29/29, taskboard 56/56, proof-guard 11/11; taskboard 0.1.84, proof-guard 0.1.8, test-cases 0.1.35. Живой профиль/:3080 не тронуты. FR1 в risk-closure deferred; push — отдельной задачей."
role: BACKEND
scope: ["plugins/test-cases/**: case_update unknown fields, realism sign-off, case/run journal, tests", "plugins/taskboard/**: task_update params/whitelist sync, reviewResults without reviewedTaskIds, task journal, close gate shell violation, flake fix, tests", "plugins/proof-guard/**: nlink hard link, test roots only, shell post-execute product audit, tests", "profile/cordis.patch.yml: tester allow remove global **/*.test.*/**/*.spec.*; proof-guard shell audit config; tests/docs", "docs/TERMINOLOGY.md/README/DEPLOYMENT: risks closed/boundaries; versions/tarballs; make test, make verify, proof"]
---

Закрыть остаточные риски (кроме живого профиля). Реальные обходы — код+тест; S4/B1 и shell — детектор/человеческое realism-подтверждение, не песочница; журнал — tamper-evident. Конкретно: (1) case_update отклоняет неизвестные поля, включая status, с кодом; (2) task_update: тест, что каждый ключ parameters доходит до patch; reviewResults без reviewedTaskIds покрыт; (3) taskboard suite стабилен под параллельной нагрузкой; (4) proof-guard: hard link nlink>1 отклоняется; allow только docs/cases/, test/, tests/ (B3: продуктовый *.test.* вне tests/ — WRITE_SCOPE; H2 root spec больше не allowed); (5) shell tester: post-execute product audit, изменение продукта фиксируется и блокирует case gate/task close; shell не песочница; (6) independent acceptance требует realism sign-off от независимого ревьювера/человека; S4 остаётся человеческим суждением; (7) журнал hash-chain для case/run и task rows; ручная правка без журнала — отказ; журнал tamper-evident. P0/P1/P2/batch не ломать; docs/cases не переписывать; live профиль/:3080 не трогать; живой пилот уже проведён и не повторять.
