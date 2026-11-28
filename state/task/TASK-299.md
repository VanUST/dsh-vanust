---
id: TASK-299
kind: task
title: "Ревью закрытия остаточных рисков (7 пунктов)"
status: done
revision: 5
createdAt: 2026-11-22T20:44:23.589Z
updatedAt: 2026-11-22T20:45:49.756Z
acceptance:
  - text: "Pass/fail по каждому из 7 рисков с evidence"
    done: false
  - text: "Пруфы/тесты перезапущены; flake-probe под нагрузкой"
    done: false
  - text: "Journal legacy/mismatch проверены; live профиль/docs/cases не тронуты"
    done: false
  - text: "Общий вердикт; задача не закрыта, push не сделан"
    done: false
boardId: task-mwsb1x20-44k6px
chore: true
choreReason: "Независимая проверка закрытия семи остаточных рисков перед закрытием задач и push; правок не требуется."
nonScope: ["не править код/тесты/README/docs/cases", "не трогать живой профиль/:3080", "не закрывать risk task; не пушить", "не переделывать P1/P2/batch"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
resultEvidence: ["taskboard 54/54, test-cases 72/72, proof-guard 10/10, proof 29/29, make verify 19/19", "close-stop 40/40, lease 27/27, role 15/15, chat-scope 26/26, limit 13/13, flake-probe 6/6", "case_update status -> CASE_FIELD_UNKNOWN; realism self -> REALISM_SIGNOFF_SELF; signed reviewer -> ACCEPTED; case hand edit -> CASE_JOURNAL_MISMATCH; legacy ok", "not reproduced: task_update reviewResults (other_chat), hard link/B3 (probe error), shell audit (runtime), TASK_JOURNAL_MISMATCH (other_chat)", "live profile mtime 09:47, docs/cases clean; risk task not closed"]
resultSummary: "Условный PASS: дефектов не найдено. Подтверждены 1 (case_update status -> CASE_FIELD_UNKNOWN), 3 (EPERM/EACCES как конкуренция в withBoardLock), 6 (realism self-signoff -> REALISM_SIGNOFF_SELF, подпись другим пресетом принята), 7a (case hand-edit -> CASE_JOURNAL_MISMATCH, legacy читается). Пункты 2 (task_update parity/reviewResults без batch), 4 (hard link/B3), 5 (shell audit рантайм), 7b (TASK_JOURNAL_MISMATCH/legacy) не воспроизведены из-за ограничений фейкового хоста (other_chat, нет agent.id/рабочего git); покрыты тестами/кодом. make test 87/87 не дождался; отдельные наборы и пруфы зелёные. Risk task не закрыт; push не делался."
role: REVIEWER
scope: ["plugins/test-cases/**, plugins/taskboard/**, plugins/proof-guard/**, profile/cordis.patch.yml", "scripts/taskboard-*-proof.mjs, scripts/taskboard-flake-probe.mjs, scripts/independent-verification-proof.mjs", "task-mws9zwaa-ontgwx (risk closure)"]
---

Независимо проверить закрытие семи остаточных рисков: (1) case_update отклоняет неизвестные поля/status; (2) task_update parameters/whitelist parity, reviewResults без reviewedTaskIds; (3) taskboard flake — EPERM/EEXIST как конкуренция, 10+ параллельных прогонов, flake-probe; (4) hard link и продуктовый *.test.* вне tests/ — WRITE_SCOPE; (5) shell product audit — детектор и блокировка product_shell_violation, не песочница; (6) realism sign-off — самоподпись отклонена, independent требует подписи; (7) case journal и task journal — hash-chain, legacy, CASE/TASK_JOURNAL_MISMATCH; 5 ранее закрытых и case journal не откачены. Проверь make test 87/87, make verify 19/19, proof 29/29, taskboard 54/54, test-cases 72/72, proof-guard 10/10, proof-скрипты 40/40/27/27/15/15/26/26, live профиль/:3080 не тронуты, docs/cases чист. Верни pass/fail по каждому и общий; задачу не закрывай.
