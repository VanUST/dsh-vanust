---
id: TASK-178
kind: task
title: "PTC волна 1: gatherer и reviewer в профиле"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.557Z
updatedAt: 2026-11-17T15:52:41.557Z
acceptance:
  - text: "ровно два ряда tool-executor-ptc — в gatherer и reviewer"
    done: false
  - text: "orchestrator, research, backend, ux, critic, docs не изменены"
    done: false
  - text: "документы называют волну, причину и откат"
    done: false
boardId: task-mwkk2ylf-cwfmh9
inline: true
nonScope: [plugins/, "живой :3080", "установленный профиль"]
resultEvidence: ["profile/cordis.patch.yml: tool-executor-ptc в preset-gatherer (962) и preset-reviewer (1041); остальные пресеты без ряда", "git diff: ровно два новых ряда; check-documentation PASS (8 preset(s), all documented)", "rules/DEPLOYMENT.md §PTC: история откатa, фикс 0.2.2-rc.3, волна gatherer/reviewer, откат двумя рядами", "docs/PTC-MODE-ANALYSIS.md §4.3-4.4, §7: таблица пресетов, результаты проверки, сессии", "reports/ptc-wave1/ — dump-config, журналы, FINDINGS.md, снимки"]
resultSummary: "Добавлены ровно два ряда tool-executor-ptc — в preset-gatherer и preset-reviewer; остальные шесть пресетов и корень остались native. rules/DEPLOYMENT.md и docs/PTC-MODE-ANALYSIS.md обновлены: волна, причина, откат, снятие старого постмортема. Проверка на :3081 подтвердила шапку из одного run_code, SDK 54/59, вложенные вызовы и корректные ответы; :3080 не тронут."
scope: [profile/cordis.patch.yml, rules/DEPLOYMENT.md, docs/PTC-MODE-ANALYSIS.md]
---

Добавить tool-executor-ptc в декларации preset-gatherer и preset-reviewer, не трогая остальные пресеты и хостовый native; обновить rules/DEPLOYMENT.md и docs/PTC-MODE-ANALYSIS.md.

Migrated from .dsh/taskboard.json (task task-mwkk2ylf-cwfmh9, revision 4).
