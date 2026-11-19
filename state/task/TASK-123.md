---
id: TASK-123
kind: task
title: "Повторно атаковать исправленные gates"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.582Z
updatedAt: 2026-11-17T15:52:40.582Z
acceptance:
  - text: "Каждый подтверждённый обход имеет команду, фактический output/exit code, path:line и почему нарушает контракт"
    done: false
  - text: "Перечислить неудавшиеся атаки как позитивные доказательства"
    done: false
  - text: "Проверить хотя бы одну mutation, которую ловит расширенный proof"
    done: false
  - text: "Вернуть только реальные blockers/high-value follow-ups, не косметику"
    done: false
boardId: task-mwf5rma7-rdwk3a
nonScope: ["Никаких production edits, live data/cases/tasks/profile, второго сервера или :3080", "Не исправлять код и не делать commit/push", "Не расширять задачу до UI/DoS/новых фич"]
owner:
  kind: agent
  label: CRITIC
  sessionId: 9f0a510f-2325-4a38-bdc5-c6bd060ba7d1
ownerRole: CRITIC
preset: critic
resultEvidence: ["node /tmp/dsh-attack2/attack2.mjs и attack2b.mjs: RESEARCH+backend child без record; fresh attach; trace tasks:[] → close ok; merge-conflict record → close/goal ok; hand edit + benign upsert → gate с tampered text; goalId:\"\" → goal complete", "M3 scratch remove requirement_has_tasks → 69/70 exit 1; M4 preset-only fix остаётся 70/70, доказывая отсутствие покрытия forged role", "positive.mjs: multi-task proven batch close, completed record и untraced L0 разрешены; production не изменён"]
resultSummary: "Повторный CRITIC подтвердил шесть обходов: role/preset confusion, fresh legacy attach, trace-only unlink разрешает close, malformed fail-open, hand-edit rebase и goalId unlink. Старые P1–P4 закрыты; mutation proof работает, но текущий 70/70 не покрывает новые пути."
role: CRITIC
scope: ["Реальные store/orchestrator/plugin guard registration на disposable dirs; baseline proof и mutation на scratch", "Атаки: role RESEARCH + preset backend; multi-task requirement и batch close; malformed record; planned↔deferred/rejected; process/decisions/openQuestions/trace mapping changes; fingerprint hand edit затем upsert/impact/linkTask; linkTask revision race; completed record и unlinked goal", "Проверить, что прежние P1–P5 действительно не воспроизводятся"]
---

Повторно атаковать исправленный analysis contour на disposable fixtures. Найти способ обойти read-only/legacy exemptions, semantic impact, task_close/update_goal или design drift и доказать наименьшими repro. Проверить также, что исправления не блокируют разрешённую многозадачную работу.

Migrated from .dsh/taskboard.json (task task-mwf5rma7-rdwk3a, revision 7).
