---
id: TASK-128
kind: task
title: "Исправить Analysis Record schema integrity"
status: cancelled
revision: 2
createdAt: 2026-11-17T15:52:40.663Z
updatedAt: 2026-11-17T15:52:40.663Z
acceptance:
  - text: "Unknown nested keys и invalid enums всегда отклоняются до записи с точным path; никакого silent projection"
    done: false
  - text: "Несколько независимых ошибок возвращаются одним findings[] за один вызов; нет каскадных повторных раундов"
    done: false
  - text: "data.ownerComponentId — единственный canonical системный владелец; owns совместимость/проекция и конфликты документированы и проверены"
    done: false
  - text: "Все validation errors сохраняют файл byte-identical и не меняют rev; CAS/fingerprint/impact/gates не регрессируют"
    done: false
  - text: "readiness/completion и designRef.at имеют явную семантику; документация содержит точные формы"
    done: false
  - text: "Новые проверки наблюдались red на прежних bytes, затем green; meaningful mutation даёт red; make verify и legacy proofs green"
    done: false
  - text: "REVIEWER и CRITIC получат полный diff после реализации; их findings не скрываются"
    done: false
boardId: task-mwj27220-stljsf
nonScope: ["Не менять taskboard, design-map layout, orchestrator gate semantics или unrelated plugins", "Не добавлять removed в contract enum: отклонять с рекомендацией breaking + description", "Не перезапускать/обновлять текущий :3080 и не менять live profile", "Не делать commit/push без отдельного пользовательского запроса", "Не перезаписывать чужие/unrelated unstaged изменения и не использовать git add -A"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 31b4473c-7383-4619-97e5-49f8b9c48a88
ownerRole: BACKEND
preset: backend
role: BACKEND
scope: ["plugins/analysis/store.mjs и analysis.mjs: strict schema, aggregate validation, canonical ownership, response semantics", "scripts/analysis-before-decomposition-proof.mjs: новые observed red-first cases, atomicity, compatibility, meaningful mutations", "plugins/analysis/README.md и только необходимые tool descriptions/docs", "package/tarball/source consistency и независимый review после реализации"]
sessions:
  - sessionId: 31b4473c-7383-4619-97e5-49f8b9c48a88
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Реализовать Analysis Record analysis-record-schema-integrity: устранить молчаливую потерю nested-полей, строго валидировать enum/обязательное содержимое, собирать все независимые ошибки за один вызов, сделать data.ownerComponentId каноническим с безопасной совместимостью, явно различать readiness/completion и доказать всё red-first. Не публиковать без отдельного запроса.

Migrated from .dsh/taskboard.json (task task-mwj27220-stljsf, revision 14).
