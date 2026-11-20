---
id: TASK-256
kind: task
title: "Обрезка результатов инструментов от хвоста: плагин tail-pruner"
status: done
revision: 3
createdAt: 2026-11-20T11:00:40.131Z
updatedAt: 2026-11-20T11:24:16.562Z
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
resultEvidence: ["node scripts/tail-pruner-proof.mjs -> all checks passed (25 проверок, включая негативный контроль oldest-first и «no contextWindow means the plugin stays quiet»)", "node scripts/tail-pruner-savings.mjs 3 -> 87 пачек обрезки, 20.0 млн свежих токенов; tail-политика (верхняя оценка) 0.68 млн = 3.4%", "make verify -> exit 0 (18/18 portability, documentation ok, glossary ok, schema-lint, context-budget, identity-guard)", "dsh --profile web-tail-proof --dump-config -> строка tail-pruner с budgetRatio 0.45, routes openai-codex 0.75; сервер слушает 127.0.0.1:3081", "git 3519375 + f7e687d"]
resultSummary: "Плагин @cc/dsh-tail-pruner добавлен в кит: перед шагом измеряет сессию тем же tokenMeter и выше бюджета (окно x 0.45) обрезает результаты инструментов от новейших, пропуская последние protectResults, и останавливается под бюджетом. Пишет пару compaction/prune + tool/result(surfaceOp replace, sourceEventSeqs). Упакован (0.1.0), строка в profile/cordis.patch.yml, inventory 28, README/USERGUIDE/DEPLOYMENT называют плагин."
steps: ["Плагин plugins/tail-pruner: config, planPrune, apply (agent/pre-step, prepend)", "package.json + README + строка в plugins/inventory.json", "pack: node scripts/pack-plugin.mjs --dir plugins/tail-pruner --no-bump", "Числа плагинов в README.md, USERGUIDE.md, rules/DEPLOYMENT.md", "Доказательство на fake-сессии (порядок, защита, бюджет, replay-safe)", "Оценка на записанных сессиях: обрезка от старых против обрезки от хвоста", "Профиль: строка плагина + второй сервер, make verify"]
stepsDone: 7
---

Добавить в кит плагин @cc/dsh-tail-pruner: перед шагом, когда контекст выше бюджета (окно x 0.45), обрезать результаты инструментов начиная с новейших (кроме последних protectResults), писать replay-safe замены; упаковать, смонтировать строку в профиле, обновить inventory и числа плагинов, доказать на fake-сессии и на записанных сессиях.
