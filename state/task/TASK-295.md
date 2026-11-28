---
id: TASK-295
kind: task
title: "P2.1: пакетное ревью — один REVIEWER на несколько задач"
status: done
revision: 9
createdAt: 2026-11-22T19:50:46.769Z
updatedAt: 2026-11-22T20:14:52.153Z
acceptance:
  - text: "delegate_review/reviewedTaskIds: одна задача ревью, один REVIEWER-child на 2–8 задач"
    done: false
  - text: "Бриф содержит контракт/результат каждой задачи; ответ — per-task verdict pass/fail/findings/evidence"
    done: false
  - text: "Проверяемые задачи остаются review и закрываются оркестратором по одной; fail одной возвращает active только её"
    done: false
  - text: "Нет per-task reviewer child/row; TESTER/REVIEWER не слиты; P2 verification/criteria не сломан"
    done: false
  - text: "Тесты, make test, make verify, proof, тарболы; живой профиль/:3080 не тронуты"
    done: false
  - text: "Документация и глоссарий: «пакетное ревью», per-task verdict"
    done: false
boardId: task-mws94ysj-1i5rsm
nonScope: ["живой профиль ~/.npm/dsh/profiles/web, :3080; PILOT P1 и P2 review", "слияние TESTER/REVIEWER; кейсы приёмки пишет TESTER, не ревьювер", "P2 verification/criteria/coverage — не откатывать", "journal/signature B1/B1' — отдельная задача", "не закрывать проверяемые задачи из ревьюверской сессии"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-195]
resultEvidence: ["one REVIEWER reviewed P2 + batch: P2 PASS, batch FAIL (task_update reviewResults dropped)", "fix taskboard 0.1.77: whitelist reviewedTaskIds/reviewResults; tool-level test batch-review.test.mjs; red without fix, green with fix", "reviewer fix PASS: bind reviewedTaskIds, incomplete/unknown refused, verdicts stored, review task closes, reviewed tasks stay review", "taskboard 48/48; make test 84/84; make verify 19/19; proof 29/29; tarball taskboard 0.1.77", "analysis batch-review rev 6 complete: FR1 deferred with reason; live profile mtime 09:47"]
resultSummary: "Пакетное ревью принято после фикса: один REVIEWER на 2–8 задач, одна задача ревью и один child, per-task verdict, проверяемые задачи остаются review и закрываются оркестратором по одной. Ревьюер нашёл блокирующий дефект task_update (reviewResults не писались); фикс taskboard 0.1.77 добавил reviewedTaskIds/reviewResults в белый список, тест через инструмент, красный/зелёный. Повторное ревью PASS. TESTER/REVIEWER не слиты; P2/P1 не тронуты; живой профиль/:3080 не тронуты. FR1 в batch-review deferred: живой профиль не установлен, live end-to-end не наблюдался; остаточные границы — синхронизация whitelist/parameters и B1′."
role: BACKEND
scope: ["plugins/orchestrator/orchestrator.mjs + tests: delegate_review tool, reviewedTaskIds, renderBrief per-task contract, per-task verdict format; policy/role docs", "plugins/taskboard/taskboard.mjs + tests: reviewedTaskIds field on task_create/update/get; review task validation 2–8; reviewed tasks not closed by reviewer; result per task", "docs/TERMINOLOGY.md: «пакетное ревью» and per-task verdict; README/DEPLOYMENT if policy", "tests: N tasks -> one review task/one child; brief has all; N verdicts; fail one only that task active; no per-task reviewer; P2 verification/criteria not broken", "package versions/tarballs: orchestrator, taskboard; make test, make verify, proof"]
---

Реализовать пакетное ревью: один REVIEWER-агент проверяет несколько задач за одну задачу ревью и возвращает вердикт по каждой. Оркестратор создаёт одну задачу ревью с reviewedTaskIds (2–8), запускает один REVIEWER-child, бриф содержит title/objective/scope/nonScope/acceptance/result/evidence каждой проверяемой задачи; ответ — pass/fail, находки и evidence по каждому taskId. Проверяемые задачи остаются в review; оркестратор закрывает их по одной своим task_close и своим условием приёмки; задача ревью закрывается отдельно. Ревьювер не закрывает проверяемые задачи. Это не слияние TESTER и REVIEWER: кейсы приёмки по-прежнему пишет TESTER. P2-контракт verification/criteria и P0/P1-гейты не ломать; живой профиль/:3080 не трогать; PILOT P1 не прерывать.
