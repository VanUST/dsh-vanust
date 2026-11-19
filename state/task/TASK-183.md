---
id: TASK-183
kind: task
title: "Native→PTC: процедура рестарта в документах"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.674Z
updatedAt: 2026-11-17T15:52:41.674Z
boardId: task-mwkl18eo-4brhv2
inline: true
nonScope: [profile/cordis.patch.yml, plugins/, "живой :3080"]
resultEvidence: ["rules/DEPLOYMENT.md §PTC — измеренное переключение старой сессии, цена шага, процедура рестарта :3080 и откат", "docs/PTC-MODE-ANALYSIS.md §4.5 — результат и ссылка на процедуру", docs/cases/native-to-ptc-resume-switches-and-is-accepted.json, "node scripts/check-documentation.mjs → documentation ok"]
resultSummary: "Записаны измеренное поведение старой native-сессии (переключается на PTC при первом возобновлении, запрос принят, один некэшированный шаг 31–33 тыс. токенов) и процедура рестарта :3080: между турнами, kit-update --apply, старт, возобновление нужных сессий, откат двумя рядами; активный турн прерывается, сессия и таскборд переживают."
scope: [rules/DEPLOYMENT.md, docs/PTC-MODE-ANALYSIS.md]
---

Записать в rules/DEPLOYMENT.md и docs/PTC-MODE-ANALYSIS.md измеренное поведение старой native-сессии при рестарте с PTC и процедуру безопасного перезапуска :3080: тихое окно, переключение при первом возобновлении, цена шага, проверка журнала, откат.

Migrated from .dsh/taskboard.json (task task-mwkl18eo-4brhv2, revision 3).
