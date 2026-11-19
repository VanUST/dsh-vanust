---
id: TASK-176
kind: task
title: "Принять плагин outline: замеры, гейты, правки после ревью"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.513Z
updatedAt: 2026-11-17T15:52:41.513Z
boardId: task-mwkjuuea-btst25
inline: true
nonScope: ["чужие правки (designmap, TERMINOLOGY)", "перезапуск :3080 и установка тарбола в профиль", "запись анализа (ведёт оркестратор)"]
resultEvidence: ["node scripts/outline-selftest.mjs → verdict PASS — 6 passed, 0 failed: 83 148 → 4 791 Б (94,2%), 100 991 → 8 924 Б (91,2%), два прогона байт-в-байт, EOVERFLOW", "подставной ctx: инструмент зарегистрирован для research, standard, backend, docs; на orchestrator.mjs 4 791 Б, symbols:18, 375–435 мс", "языки: .mjs/.js/.jsx, .ts, .tsx, .py работают; .go даёт только типы (struct:T), функции не попадают — ограничение парсера 0.1.3", "ошибки: несуществующий файл → {ok:false,code:'EXIT',message:'...File not found...'}, markdown → EXIT Unsupported file type; отсутствие path отбивает харнесс (INVALID_ARGS)", "профиль: ряд на уровне хоста (profile/cordis.patch.yml:392-394), пресеты начинаются со строки 607", "node scripts/provision-tools.mjs --check → ok code-skeleton-mcp 0.1.3, 20/20; node scripts/check-documentation.mjs → documentation ok (24 плагина)", "после правок ревью: тарбол cc-dsh-outline-0.1.1.tgz sha256 8cfdd944…, побайтно равен исходникам; sectionText отдаёт 4 791 Б и ~0,4 с", "check-portability 16/17: единственный FAIL — designmap README (чужая параллельная правка), по outline провалов нет"]
resultSummary: "Плагин outline проверен и принят: инструмент зарегистрирован для всех проверенных пресетов подставным контекстом, экономия 91–94% на реальных файлах при 0,4 с на вызов, деградация без бинаря работает, документы и инвентарь согласованы. По замечаниям ревью исправлены числа (4 791/8 924/5 390/57 490 Б), ложное утверждение о коде выхода CLI, дополнены USERGUIDE и README, зафиксировано ограничение Go (только типы); плагин перепакован в 0.1.1."
scope: ["plugins/outline, scripts/outline-selftest.mjs, plugins/cc-dsh-outline-*.tgz", "правки README.md, USERGUIDE.md, rules/DEPLOYMENT.md"]
---

Самому проверить и принять плагин outline: прогнать селфтест и гейты, проверить регистрацию инструмента для пресетов подставным контекстом, проверить языки (Python, Go, TS, TSX) и деградацию, внести правки по замечаниям ревью (числа, ложное утверждение о коде выхода, неполные документы, ограничение Go), перепаковать тарбол и подтвердить требования записи анализа.

Migrated from .dsh/taskboard.json (task task-mwkjuuea-btst25, revision 4).
