---
id: TASK-256
kind: task
title: "Обрезка результатов инструментов от хвоста: плагин tail-pruner"
status: open
revision: 1
createdAt: 2026-11-20T11:00:40.131Z
updatedAt: 2026-11-20T11:00:40.131Z
acceptance:
  - text: "planPrune отдаёт кандидатов в порядке убывания seq и прекращает обрезку под бюджетом"
    done: false
  - text: "последние protectResults результатов не тронуты"
    done: false
  - text: "на каждую обрезку: compaction/prune + tool/result(surfaceOp replace, sourceEventSeqs)"
    done: false
  - text: "тарбол собран, inventory и профиль согласованы, check-documentation зелёный"
    done: false
  - text: "make verify exit 0"
    done: false
boardId: task-mwovbjnk-zuq3gj
inline: true
reqIds: [REQ-168, REQ-169, REQ-170, REQ-171]
steps: ["Плагин plugins/tail-pruner: config, planPrune, apply (agent/pre-step, prepend)", "package.json + README + строка в plugins/inventory.json", "pack: node scripts/pack-plugin.mjs --dir plugins/tail-pruner --no-bump", "Числа плагинов в README.md, USERGUIDE.md, rules/DEPLOYMENT.md", "Доказательство на fake-сессии (порядок, защита, бюджет, replay-safe)", "Оценка на записанных сессиях: обрезка от старых против обрезки от хвоста", "Профиль: строка плагина + второй сервер, make verify"]
stepsDone: 0
---

Добавить в кит плагин @cc/dsh-tail-pruner: перед шагом, когда контекст выше бюджета (окно x 0.45), обрезать результаты инструментов начиная с новейших (кроме последних protectResults), писать replay-safe замены; упаковать, смонтировать строку в профиле, обновить inventory и числа плагинов, доказать на fake-сессии и на записанных сессиях.
