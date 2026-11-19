---
id: TASK-132
kind: task
title: "Финальный review schema integrity"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.730Z
updatedAt: 2026-11-17T15:52:40.730Z
acceptance:
  - text: "Для каждого прежнего blocker: FIXED или новый current repro с command/output/exit code/path"
    done: false
  - text: "Независимо подтвердить 129/129, make verify, legacy proofs, source/tarball и migrated record"
    done: false
  - text: "Проверить, что proof не зависит от отсутствия migrated record в будущем commit без необходимости"
    done: false
  - text: "Оценить stale owner cases и точный минимальный способ честно обновить их без fake red"
    done: false
  - text: "Вердикт APPROVE/CHANGES_REQUIRED и только accepted residuals"
    done: false
boardId: task-mwj3cn6t-eridpq
nonScope: ["Read-only; не менять source/cases/analysis record/taskboard/profile и не делать commit/push", "Не запускать второй сервер и не перезапускать :3080", "Не требовать новые фичи; принятые residuals остаются: mixed batch atomic, raw malformed без id, UTF-16 limits, explicit legacyAttach"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 40bf4624-01ff-449c-aa7c-9eaa90b14945
ownerRole: REVIEWER
preset: reviewer
resultEvidence: ["node scripts/analysis-before-decomposition-proof.mjs → 129/129 exit 0 (/tmp/final9-proof.out); make verify 17/17+docs; legacy 27/27,15/15,26/26,13/13", "No-loss/Unicode, duplicates, structural+semantic, ambiguous gate/link/close/goal, legacy migration и real hand edit — current FIXED", "Proof без docs/analysis record → 128/129 exit 1; значит record + design.excalidraw rev30 должны входить в change", "Cases rev6 stale со старыми surfaces/107 evidence; current 129 proof и red 111/129 должны заменить их честно", "Tarball 0.1.8 d54212eb byte-match source; :3080 old 0.1.4 mismatch — deployment skew, не дефект"]
resultSummary: "REVIEWER по коду APPROVE после 0.1.8: все прежние schema/stateful findings fixed. Остались publication/evidence действия: включить migrated Analysis Record + design map в будущий commit, обновить три stale owner cases на red 111/129 и green 129/129, собирать только exact feature files при будущей публикации."
role: REVIEWER
scope: ["Запустить 129-proof, make verify и legacy proofs; проверить red 18 и 3 mutation logs", "Повторить no-loss/Unicode, trimmed/process duplicates, structural+semantic aggregate, ambiguous gate/link/close/goal, genuine 0.1.4 fingerprint migration и real hand edit", "Проверить migrated Analysis Record через NEW source service, source/tarball, cases/stale status и diff", "Отделить deployment skew :3080 old 0.1.4 от фактического поведения новых bytes"]
sessions:
  - sessionId: 40bf4624-01ff-449c-aa7c-9eaa90b14945
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Проверить финальный незакоммиченный @cc/dsh-analysis 0.1.8 после SCHEMA handoff. Подтвердить, что все прежние reviewer/critic findings закрыты на current source и что proof/limits/migration/ownership не создали новый blocker. Дать APPROVE/CHANGES_REQUIRED по frozen checklist, без новых направлений.

Migrated from .dsh/taskboard.json (task task-mwj3cn6t-eridpq, revision 6).
