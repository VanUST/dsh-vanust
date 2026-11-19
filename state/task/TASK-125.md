---
id: TASK-125
kind: task
title: "Финальный regression attack"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.614Z
updatedAt: 2026-11-17T15:52:40.614Z
acceptance:
  - text: "Для каждого прежнего дефекта: FIXED или актуальный FAIL с output"
    done: false
  - text: "Подтвердить отсутствие обхода draft→unlink→ready→close и fresh attach без flag"
    done: false
  - text: "Дать PASS/FAIL verdict и точные команды/exit codes, без новых пожеланий"
    done: false
boardId: task-mwf70qxo-7je7r2
nonScope: ["Никаких production edits/live state/second server/commit/push", "Не начинать новые направления атак, DoS или UI"]
owner:
  kind: agent
  label: CRITIC
  sessionId: 9f0a510f-2325-4a38-bdc5-c6bd060ba7d1
ownerRole: CRITIC
preset: critic
resultEvidence: ["node scripts/analysis-before-decomposition-proof.mjs → 93/93 exit 0 (/tmp/regression-baseline.log)", "/tmp/dsh-attack2/attack2.mjs и attack2b.mjs: forged role/fresh attach/goal unlink → analysis_required/goal_link_locked; trace unlink refused; hand edit → fingerprint_mismatch; acceptHandEdit repair PASS", "node /tmp/reg-f4.mjs: merge-conflict record с task id → analysis_stale; без id → untraced residual", "Scratch mutation без trace_task_removal → 91/93 exit 1 (/tmp/regression-mutation.log)"]
resultSummary: "Финальный CRITIC regression verdict PASS для 0.1.4/0.1.43: все прежние F1–F6 и round-4 обходы закрыты, 93/93 green, meaningful mutation 91/93 red. Разрешённые non-last/batch/legacy/repair пути работают. Единственный residual — malformed record без literal task/goal id не может быть атрибутирован."
role: CRITIC
scope: ["Повторить F1–F6, B1–B9 и round-4 draft unlink/restart legacy/disposition/mapping на disposable copies", "Запустить baseline 93/93 и одну meaningful mutation, которая должна дать red", "Проверить разрешённые non-last close, proven batch, explicit legacy и hand-edit repair пути"]
---

Прогнать уже существующие attack repros против 0.1.4/0.1.43 и подтвердить, что прежние обходы закрыты. Не искать новые классы атак; нужен короткий regression verdict перед push.

Migrated from .dsh/taskboard.json (task task-mwf70qxo-7je7r2, revision 7).
