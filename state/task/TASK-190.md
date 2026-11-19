---
id: TASK-190
kind: task
title: "P0.1: Перепроверить упаковку и `make verify`"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.831Z
updatedAt: 2026-11-17T15:52:41.831Z
acceptance:
  - text: "check-portability: 17/17, включая tarball:matches-source и tarball:version-bumped, exit 0"
    done: false
  - text: "make verify: exit 0"
    done: false
boardId: task-mwknzcmm-x8j01x
inline: true
nonScope: ["перепаковка плагинов — только если проверка падает, и тогда отдельное решение", "изменения в коде или документах"]
resultEvidence: ["node scripts/check-portability.mjs → 17/17, включая [PASS] tarball:matches-source и [PASS] tarball:version-bumped, exit 0", "make verify → check-portability 17/17 + documentation ok, exit 0"]
resultSummary: "Упаковка воспроизводит рабочее дерево: 17/17 проверок переносимости и упаковки, `make verify` зелёный. Перепаковка не потребовалась — расхождений исходник/тарбол нет."
scope: ["прогон node scripts/check-portability.mjs", "прогон make verify"]
---

Подтвердить пункт P0.1 дизайна (§8.6 обзора): каждый тарбол кита совпадает с исходником, версия поднята, `make verify` зелёный. Это условие входа: пока упаковка не воспроизводит рабочее дерево, установка кита на машину не проверяема.

Migrated from .dsh/taskboard.json (task task-mwknzcmm-x8j01x, revision 4).
