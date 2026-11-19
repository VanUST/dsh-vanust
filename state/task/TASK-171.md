---
id: TASK-171
kind: task
title: "Удалить Headroom из кита, сузить раздел RTK, добавить правило чтения инструментами"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.414Z
updatedAt: 2026-11-17T15:52:41.414Z
acceptance:
  - text: "grep -rni headroom с исключениями node_modules/.git/reports/.serena/.cache/.dsh/.playwright-mcp не находит ничего, кроме одного исторического абзаца в docs/CONTEXT-ECONOMY-DESIGN.md вида «Headroom удалён 2026-11-17, потому что…»; других файлов с упоминанием нет"
    done: false
  - text: "node scripts/rtk-selftest.mjs — зелёный, ожидания фильтрации не менялись"
    done: false
  - text: "make verify — оба скрипта зелёные (check-portability, check-documentation)"
    done: false
  - text: "node scripts/provision-tools.mjs --check больше не перечисляет Headroom и не падает"
    done: false
  - text: "в отчёте дословно процитирован новый sectionText и новый пункт CHILD_POLICY"
    done: false
  - text: "в новом sectionText названо не более пяти команд"
    done: false
  - text: "оба тарбола перепакованы, версии в plugins/rtk/package.json и plugins/orchestrator/package.json подняты, старых tgz рядом нет"
    done: false
  - text: "grep -rn 'headroom' start.sh start.ps1 scripts/ пуст"
    done: false
boardId: task-mwkigak3-5y7y50
nonScope: ["не менять classifyCommand, FILTER_NAMES, обработчик tools/post-execute, banner в plugins/rtk/rtk.mjs — меняется только текст раздела", "не включать трассировку debug (владелец отказался)", "не трогать живой сервер на :3080, не перезапускать dsh web", "не удалять и не переписывать reports/, .dsh/, .cache/, docs/cases/* — это история", "не менять машину: процессы headroom, ~/.npm/dsh/headroom и установленный инструмент удаляет оркестратор", "не решать вопрос о внешних инструментах чтения — это отдельная исследовательская задача", "не править docs/analysis/context-output-economy.json — запись анализа ведёт оркестратор"]
owner:
  kind: agent
  label: BACKEND
  sessionId: f2acccf8-ca8a-480c-886e-498c6eebdbc9
ownerRole: BACKEND
preset: backend
resultEvidence: ["git diff -U0 plugins/rtk/rtk.mjs: 4 хунка — FILTERED_COMMANDS удалена, sectionText переписан; classifyCommand, FILTER_RULES, post-execute не тронуты", "node scripts/rtk-selftest.mjs → PASS, 6 shrank / 3 passed / 0 failed", "grep -rniE headroom по документам поставки и скриптам → пусто", "tar -xzOf обоих новых тарболов | diff - исходники → пусто"]
resultSummary: "Изменение кита выполнено и проверено: Headroom убран из 12 файлов поставки, раздел RTK заменён нишей и правилом, в CHILD_POLICY добавлено правило чтения инструментами, плагины перепакованы (0.1.7 и 0.1.47)."
role: BACKEND
scope: ["удалить profile/headroom.patch.yml и scripts/headroom.mjs", "start.sh и start.ps1: убрать ветку запуска HEADROOM, переменную и строки справки в шапке", "scripts/provision-tools.mjs: убрать запись инструмента headroom (и шаги uv/python, если они существуют только ради него; путь uvx для MCP не трогать)", "scripts/kit-update.mjs: убрать упоминание headroom в тексте флага --no-tools и в комментариях", "NOTICE, README.md, USERGUIDE.md, rules/DEPLOYMENT.md, docs/CONTEXT-ECONOMY-DESIGN.md, docs/context-economy.svg.html: убрать Headroom из описаний и таблиц", "plugins/rtk/rtk.mjs: переписать только sectionText; plugins/rtk/README.md: привести описание раздела в соответствие", "plugins/orchestrator/orchestrator.mjs: добавить правило чтения в CHILD_POLICY", "перепаковать plugins/rtk и plugins/orchestrator через node scripts/pack-plugin.mjs --dir <путь> (версии патчем, старые tgz скрипт удалит сам)"]
---

В репозитории /home/iustimov/dsh-kit сделать три согласованных владельцем изменения и довести гейты кита до зелёного: (1) полностью убрать Headroom из поставки кита; (2) сузить раздел промпта плагина RTK до измеренной ниши с правилом вместо каталога 26 фильтров; (3) добавить в политику специалиста плагина оркестратора правило читать файлы инструментом read (offset/limit) и искать grep/glob вместо переливки файлов через sed/cat/ls. Поведение перехвата RTK не меняется: правится только текст раздела промпта.

Migrated from .dsh/taskboard.json (task task-mwkigak3-5y7y50, revision 7).
