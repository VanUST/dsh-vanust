---
id: TASK-131
kind: task
title: "Завершить schema integrity по handoff"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.713Z
updatedAt: 2026-11-17T15:52:40.713Z
acceptance:
  - text: "NO LOSS: over-limit strings/arrays отклоняются до normalize с limit_exceeded/path/max/actual; successful write ничего не обрезает, Unicode не повреждается; error оставляет bytes/rev неизменными"
    done: false
  - text: "AGGREGATE: trimmed duplicates во всех секциях + process current/target duplicates и независимые semantic findings возвращаются первым ответом; normalize не открывает их позже; зависимые semantic checks подавляются без каскадов"
    done: false
  - text: "OWNERSHIP: ambiguous record read с warning, но gate/linkTask fail closed до canonical owner; после resolution все пути работают"
    done: false
  - text: "LEGACY FP: genuine 0.1.4 запись признаётся legacy, не hand edit; versioned recognition + deterministic current migration/history позволяют read/gate/link/upsert/close/goal; настоящий hand edit по-прежнему refused"
    done: false
  - text: "MIGRATION: current Analysis Record получает ownerComponentId C-STORE у D-RECORD/D-FINDINGS, derived owns, status ready, current fingerprint и разрешённые impacts; это доказано через новый service/tool path, не молчаливая ручная правка"
    done: false
  - text: "PROOF: каждая новая проверка red на pre-fix 0.1.7, green после; no-loss/ambiguous-gate/legacy-fp mutations red; прежние 107 checks и legacy proofs green; make verify/source tarball green"
    done: false
  - text: "REPORT: точные commands/output/exit codes, changed files, current record rev/status/fingerprint, residuals. Не commit/push"
    done: false
boardId: task-mwj2ydz0-jxok0k
nonScope: ["Не повторять исследование: использовать готовые repro и текущий source", "Не менять taskboard, design-map, orchestrator или unrelated plugins", "Не перезапускать/обновлять :3080 и не менять live profile", "Не делать commit/push и не трогать unrelated .reasonix/design.excalidraw/stale cases", "Не ослаблять strict validation или молча удалять лимиты"]
owner:
  kind: agent
  label: SCHEMA
  sessionId: 14f51519-4fd3-4b6b-b0c2-92e2dfa4ddde
ownerRole: SCHEMA
preset: backend
resultArtifacts: [https://github.com/VanUST/dsh-vanust/commit/21f18fff2d4a41651db1fb4588b811c1d0f0bcc8, https://github.com/VanUST/dsh-vanust/commit/e157e74fa6993aeac4c683bf4cc7fa05a031dcfa, https://github.com/VanUST/dsh-vanust/commit/eb05a30bcfe43d3f77f98d31e0b9733d365480f6]
resultEvidence: ["Финальный proof 130/130 exit 0 (/tmp/lifecycle-final-proof.log); make verify 17/17 + documentation ok (/tmp/lifecycle-final-verify.log)", "Analysis Record rev7 completed, 6 proven/0 planned, pending 0, current fingerprint и goalRefusal ok (/tmp/lifecycle-head-record.log)", "Commits 21f18ff (feature), e157e74 (terminal lifecycle), eb05a30 (case metadata); local HEAD == remote main eb05a30bcfe43d3f77f98d31e0b9733d365480f6; GitHub API HTTP 200 подтвердил commit", "REVIEWER code APPROVE task-mwj3cn6t-eridpq; CRITIC PASS task-mwj3cnu3-kp2gio; три cases revision 9 verified, case_drift clean", "No-loss/Unicode, aggregate duplicates/semantic, ambiguous gate/link/close/goal, legacy recognition/migration, CAS и прежние stateful guards подтверждены red/green/mutations"]
resultSummary: "Schema integrity реализована, независимо проверена и опубликована в origin/main. Финальная публикация eb05a30 включает strict lossless validation, aggregate findings, canonical ownership, legacy migration, completed Analysis Record и verified owner cases. :3080 не перезапускался; пользователь перезагружает harness сам."
role: SCHEMA
scope: ["plugins/analysis/store.mjs/analysis.mjs/README: six confirmed findings only", "scripts/analysis-before-decomposition-proof.mjs: failing checks for each, then green and mutations", "docs/analysis/analysis-record-schema-integrity.json: canonical D-RECORD/D-FINDINGS ownerComponentId C-STORE, ready/current fingerprint/history", "Package bump/tarball/source match, make verify и legacy proofs; финальный report/diff"]
sessions:
  - sessionId: 14f51519-4fd3-4b6b-b0c2-92e2dfa4ddde
    label: SCHEMA
    role: SCHEMA
    status: sleeping
---

Завершить незаконченную реализацию analysis-record-schema-integrity по свежему handoff, не повторяя 400-step исследование. Прежняя сессия оставила точные repro, но не меняла код после 0.1.7. Нужны самые маленькие структурные исправления, red-first checks, миграция текущей записи и полный proof; без commit/push.

Migrated from .dsh/taskboard.json (task task-mwj2ydz0-jxok0k, revision 16).
