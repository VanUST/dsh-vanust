---
id: TASK-398
kind: task
title: "Проектный журнал state/: слияние двух машин по git"
status: done
revision: 3
createdAt: 2026-11-23T08:44:12.203Z
updatedAt: 2026-11-23T08:44:33.310Z
acceptance:
  - text: "два клона с одним номером дают две записи после пула"
    done: false
  - text: "дубль требования по идентичности сводится к одной записи"
    done: false
  - text: "replay() и verify() проходят, seq 1..N"
    done: false
  - text: "повторный запуск не меняет байтов"
    done: false
  - text: "отчёт называет каждую коллизию"
    done: false
boardId: task-mwt0rlur-ng0x8h
inline: true
reqIds: [REQ-281, REQ-282, REQ-283, REQ-284]
resultEvidence: ["node --test plugins/project-state/test/merge.test.mjs — 8/8", "node scripts/state-merge-proof.mjs — 23/23 на двух клонах (конфликт, отчёт, уникальные номера, replay/verify, идемпотентность)", "CASE_NEGATIVE_CONTROL=expect-pre-fix node scripts/state-merge-proof.mjs — падение 10/18 (негативный контроль)", "TEST-088: red mwt0r3r1-vcz2x-1:fail, green mwt0r5gv-7qjvn-1:pass", "make verify — VERIFY_EXIT=0 (19/19 portability); make test — 89/89 (71 plugin test file, 18 proof script)"]
resultSummary: "state/ сливается как журнал проекта по git: scripts/state-merge.mjs читает обе стороны (HEAD, MERGE_HEAD, merge-base), объединяет записи по машинно-независимой идентичности (boardId, caseId, analysisRef, createdAt), выдаёт второй записи следующий номер, сводит одну запись под двумя номерами, объединяет события по eid и перенумеровывает seq, пересчитывает хеши ссылок, дописывает честные synthetic-события, пересобирает проекции и печатает отчёт о каждой коллизии. AGENTS.md, rules/DEPLOYMENT.md, USERGUIDE и TERMINOLOGY описывают шаг; make pull запускает его после пула."
steps: ["Описать правило идентичности записей и слияния (запись анализа L2)", "Реализовать mergeStates и команду scripts/state-merge.mjs", "Связать событие с eid и починить seq в core", "Доказать двумя клонами: красный на выборе стороны, зелёный после слияния", "Описать шаг в AGENTS.md, rules/DEPLOYMENT.md, USERGUIDE и TERMINOLOGY"]
stepsDone: 5
---

state/ — журнал проекта, а не машины: при конфликте после пула агент одной командой сливает обе стороны, получает уникальные номера, объединённый журнал и явный отчёт о коллизиях, а verify()/replay() проходят. Процесс описан в AGENTS.md, правилах развёртывания и USERGUIDE.
