---
id: TASK-177
kind: task
title: "PTC-миграция: обзор плагинов, пресетов и распределения"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.537Z
updatedAt: 2026-11-17T15:52:41.537Z
acceptance:
  - text: "таблица распределения инструментов по восьми пресетам"
    done: false
  - text: "вердикт по каждому семейству плагинов и по изменению design map"
    done: false
  - text: "выбранная волна и её обоснование"
    done: false
boardId: task-mwkk2ygm-l7shij
inline: true
nonScope: ["изменение кода плагинов", "живой :3080"]
resultEvidence: ["plugins/inventory.json — 24 плагина, 23 mounted, work-modes не смонтирован", "разбор profile/cordis.patch.yml: восемь пресетов, у gatherer нет web/present, у orchestrator/research нет bash; backend/ux/reviewer/critic/docs почти совпадают по составу", "grep additionalContexts по plugins/*/*.mjs — только rtk.mjs:642 (передаёт дальше, сам не добавляет)", "designmap/manifest.json: модель sha256:699c3c8c…, совпадает с designmap/model.yaml; коммит 396d8ef — панель геометрии, не семантическая карта", "docs/PTC-MODE-ANALYSIS.md §4.3-4.4 — таблица по восьми пресетам и решение волны 1"]
resultSummary: "Просмотрены 24 плагина, восемь пресетов и изменение design map. Распределение плагинов менять не нужно: общие инструменты уже на уровне хоста, ролевые — в пресетах; единственное изменение для PTC — ряд исполнителя в двух декларациях. Все инструменты кита — обычные JSON-инструменты; единственный побочный канал — additionalContexts в rtk (передаёт дальше, не добавляет); картинки приходят только из Playwright MCP; долгие вызовы — babysitter, не в волне 1. Изменение design map — панель геометрии, хеш семантической модели не изменился. Волна 1: gatherer и reviewer."
scope: [plugins/inventory.json, profile/cordis.patch.yml, "plugins/*", designmap/, docs/analysis/ptc-preset-migration.json]
---

Просмотреть 24 плагина кита, восемь пресетов и изменение design map; решить, нужно ли менять распределение плагинов по пресетам, и зафиксировать волну PTC-миграции.

Migrated from .dsh/taskboard.json (task task-mwkk2ygm-l7shij, revision 3).
