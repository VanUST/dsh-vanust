---
id: TASK-297
kind: task
title: "Ревью фикса пакетного ревью (task_update reviewResults)"
status: done
revision: 5
createdAt: 2026-11-22T20:01:45.326Z
updatedAt: 2026-11-22T20:44:25.180Z
acceptance:
  - text: "Фикс подтверждён: task_update пишет reviewResults через инструмент; red/green тест воспроизведён"
    done: false
  - text: "Закрытие задачи ревью проходит; проверяемые задачи остаются review; неполный/неизвестный вердикт отклоняется"
    done: false
  - text: "P2/P1 не сломаны; make test/verify/proof зелёные; живой профиль/:3080 не тронуты"
    done: false
  - text: "Вердикт pass/fail; задача не закрыта"
    done: false
boardId: task-mws9j30g-7flsfh
chore: true
choreReason: "Проверка фикса блокирующего дефекта пакетного ревью: task_update должен писать reviewedTaskIds/reviewResults через инструмент, а не только через сервис."
nonScope: ["не править код/тесты/README/docs/cases", "не трогать живой профиль/:3080", "не закрывать batch task", "не переделывать P2/P1"]
owner:
  kind: agent
  label: REVIEWER
preset: reviewer
resultEvidence: ["task_update bind reviewedTaskIds -> stored ['t1','t2']; incomplete/unknown -> review_results_incomplete; verdicts in file t1:pass, t2:fail with findings", "batch-review.test.mjs new tool-level test passes; taskboard 48/48; make test 84/84; make verify 19/19; proof 29/29", "taskboard 0.1.77 whitelist includes reviewedTaskIds/reviewResults; tarball fc45a477", "P2/P1 unchanged; live profile mtime 09:47, docs/cases clean"]
resultSummary: "Фикс пакетного ревью принят: task_update теперь пишет reviewedTaskIds и reviewResults через сам инструмент; неполный и неизвестный вердикт отклоняются; задача ревью закрывается, проверяемые задачи остаются review. Тест через task_update, красный без фикса / зелёный с ним. taskboard 0.1.77; make test 84/84, make verify 19/19, proof 29/29; живой профиль и :3080 не тронуты. Остаточная граница: белый список полей и parameters могут рассинхронизироваться; вердикты пишет сессия ревьювера (B1′)."
role: REVIEWER
scope: ["plugins/taskboard/taskboard.mjs + batch-review.test.mjs; taskboard README", "task-mws94ysj-1i5rsm (batch review fix)", "make test/verify, proof, taskboard tests"]
---

Проверить фикс пакетного ревью: taskboard 0.1.77, task_update принимает и сохраняет reviewedTaskIds и reviewResults, неполный/неизвестный вердикт отклоняется, тест через сам инструмент task_update (не service.update), задача ревью закрывается, проверяемые задачи остаются в review. Подтвердить красный прогон без фикса и зелёный с фиксом; make test 84/84, make verify 19/19, proof 29/29; P2 (taskboard 0.1.75, test-cases 0.1.33, orchestrator 0.1.66) и P0/P1 не сломаны; живой профиль/:3080 не тронуты. Не правь код; верни pass/fail с находками и evidence.
