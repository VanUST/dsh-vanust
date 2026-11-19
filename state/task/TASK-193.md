---
id: TASK-193
kind: task
title: "P0.5: README — двенадцать инструментов test-cases вместо восьми"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.890Z
updatedAt: 2026-11-17T15:52:41.890Z
acceptance:
  - text: "README называет двенадцать инструментов и совпадает с регистрациями"
    done: false
  - text: "check-documentation: зелёный, exit 0"
    done: false
boardId: task-mwknzd3h-4gll5n
inline: true
nonScope: ["plugins/test-cases — код не меняется", "rules/DEPLOYMENT.md — там уже двенадцать"]
resultEvidence: ["README.md:55 — «Twelve host tools» и двенадцать имён, включая case_run, case_suite, case_gate, case_remove", "grep -c \"name: 'case_\" plugins/test-cases/test-cases.mjs → 12 регистраций", "node scripts/check-documentation.mjs → documentation ok, exit 0"]
resultSummary: "README описывает test-cases как двенадцать инструментов и совпадает с регистрациями: добавлены case_run (исполняет сохранённую команду), case_suite, case_gate, case_remove; проверка документов зелёная."
scope: ["README.md — абзац про @cc/dsh-test-cases", "прогон node scripts/check-documentation.mjs"]
---

Исправить §8.7 обзора: README.md в разделе про @cc/dsh-test-cases говорит «Eight host tools» и перечисляет восемь, а плагин 0.1.12 регистрирует двенадцать (лишние: case_run, case_suite, case_gate, case_remove). README должен описывать пакет так, как он есть, включая то, что case_run исполняет сохранённую команду.

Migrated from .dsh/taskboard.json (task task-mwknzd3h-4gll5n, revision 4).
