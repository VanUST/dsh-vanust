---
id: TASK-296
kind: task
title: "Ревью P2 + пакетного ревью одним REVIEWER"
status: done
revision: 5
createdAt: 2026-11-22T19:57:18.509Z
updatedAt: 2026-11-22T20:01:47.171Z
acceptance:
  - text: "P2: pass/fail с находками; verification/criteria/coverage/brief проверены"
    done: false
  - text: "Batch: pass/fail с находками; один задачный ряд/один child на N задач, per-task verdict, reviewed tasks не закрываются ревьювером"
    done: false
  - text: "P0/P1 не сломаны; live-профиль/:3080 не тронуты"
    done: false
  - text: "Два отдельных вердикта в одном отчёте; задачи не закрыты"
    done: false
boardId: task-mws9dd56-rganyl
chore: true
choreReason: "Проверка двух задач (P2 task contract и пакетное ревью) одним ревьювером — первый практический случай пакетного ревью; задачи уже в review, реализации готовы."
nonScope: ["не править код/тесты/README/docs/cases", "не трогать живой профиль ~/.npm/dsh/profiles/web и :3080", "не закрывать P2/batch задачи (закрывает оркестратор)", "не реализовывать P1 pilot/P2.1 заново"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
resultEvidence: ["P2: independent no criteria -> CRITERIA_REQUIRED; with criteria no cases -> CRITERIA_UNCOVERED coverage AC-1/AC-2; proof/case -> ok:true; unverified case covers false; contractBlock one role-agnostic text", "Batch: task_update reviewResults -> ok:true but field undefined; task_close -> review_results_missing; reviewed_task_close refuses; delegate_review one row/one child; t1 closes alone, t2 stays review", "test-cases 66/66 (or 67 claimed), taskboard 47/47 isolated, orchestrator 20/20, make test 84/84, make verify 19/19, proof 29/29", "live profile mtime 09:47, docs/cases clean; tasks not closed"]
resultSummary: "Один REVIEWER проверил две задачи. P2 (task-mws8uh2x-uqkuuf) — PASS: independent без критериев -> CRITERIA_REQUIRED, с критериями без кейсов -> CRITERIA_UNCOVERED с покрытием; proof/case закрываются без кейса; criterionId сохраняется; непринятый кейс не покрывает; contractBlock один для всех ролей. Пакетное ревью (task-mws94ysj-1i5rsm) — FAIL: task_update не пишет reviewResults (белый список taskboard.mjs:2789), поэтому ревьювер не может отчитаться и задача ревью не закрывается. Проверяемые задачи не закрыты; код не правился. P2 можно принимать; batch возвращён в active на фикс."
role: REVIEWER
scope: ["plugins/taskboard/**, plugins/test-cases/**, plugins/orchestrator/** (чтение и прогоны)", "README/TERMINOLOGY/DEPLOYMENT, proof scripts", "taskboard tasks task-mws8uh2x-uqkuuf (P2) и task-mws94ysj-1i5rsm (batch review)"]
---

Один REVIEWER проверяет две задачи сразу и возвращает отдельный вердикт по каждой: (1) P2 task contract — taskboard 0.1.75, test-cases 0.1.33, orchestrator 0.1.66: verification proof|case|independent, критерии с id, ограничения, одинаковый бриф backend/tester/reviewer, покрытие только independent, proof/case без кейса; (2) пакетное ревью — taskboard 0.1.76, orchestrator 0.1.67: delegate_review, reviewedTaskIds 2–8, один REVIEWER-ребёнок на N задач, per-task verdict, проверяемые задачи остаются review и закрываются оркестратором по одной, fail одной не закрывает остальные, TESTER и REVIEWER не слиты. Запусти заявленные проверки; P0/P1-поведение и живой профиль/:3080 не ломать. Не правь код, не закрывай задачи; верни по каждому taskId pass/fail, находки и evidence.
