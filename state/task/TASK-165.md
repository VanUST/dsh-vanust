---
id: TASK-165
kind: task
title: "PTC-анализ: что даёт режим, перенос пресетов и лимит шагов"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.306Z
updatedAt: 2026-11-17T15:52:41.306Z
acceptance:
  - text: "Документ содержит измеренные числа с идентификаторами сессий и командами"
    done: false
  - text: "Вывод по каждому из восьми пресетов: можно/нельзя и почему"
    done: false
  - text: "Ответ на вопрос о лимите шагов и префиксном кэше сформулирован прямо"
    done: false
  - text: "Термин PTC определён в глоссарии"
    done: false
boardId: task-mwkiaw43-oyn0p9
inline: true
nonScope: ["profile/cordis.patch.yml — живой профиль не меняется без отдельного решения", "plugins/ — код плагинов не меняется"]
resultEvidence: ["docs/PTC-MODE-ANALYSIS.md — 451 строка, все числа взяты из журналов сессий", "native-плечо session-5bf9f4ff-92da-40ca-8f75-2857693769b5: 11 шагов, 79 вызовов, 88 948 miss / 645 248 hit / 16 478 output, $0.0270", "PTC-плечо session-8ddea287-b3fe-4ab9-98ee-ec68e1f8fb14: 18 шагов, 17 run_code + 36 вложенных, 33 362 miss / 571 264 hit / 17 803 output, $0.0185", "Возобновление session-40f5b5fd-ea0d-41a9-9237-3ab5324aa005: request/header reason=resume с единственным run_code, 1 tool-addition и 58 tool-removal, ошибки нет", "reports/ptc-mode-analysis/evidence/ — логи прогонов, слои и task.txt", "docs/TERMINOLOGY.md строки 81-82 — определения «шаг» и PTC"]
resultSummary: "Написан docs/PTC-MODE-ANALYSIS.md: механика PTC, измеренное сравнение native и PTC на одной задаче, разбор переноса восьми пресетов, прямой ответ про лимит 300/400/500 и префиксный кэш. Термин PTC и «шаг» добавлены в docs/TERMINOLOGY.md."
scope: [docs/PTC-MODE-ANALYSIS.md, docs/TERMINOLOGY.md, reports/ptc-mode-analysis/]
---

Написать в docs/PTC-MODE-ANALYSIS.md разбор режима PTC: механика, измеренный опыт (native vs PTC на одной задаче), возможность переноса восьми кастомных пресетов, и анализ лимита 300/400/500 шагов с точки зрения префиксного кэша. Добавить термин PTC в docs/TERMINOLOGY.md.

Migrated from .dsh/taskboard.json (task task-mwkiaw43-oyn0p9, revision 4).
