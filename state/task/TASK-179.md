---
id: TASK-179
kind: task
title: "PTC волна 1: проверка gatherer и reviewer на втором сервере"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.578Z
updatedAt: 2026-11-17T15:52:41.578Z
acceptance:
  - text: "Временный слой собран механически из двух блоков profile/cordis.patch.yml (не перепечатан), и `--dump-config` показывает tool-executor-ptc внутри preset-gatherer и preset-reviewer; у preset-orchestrator и preset-research его нет"
    done: false
  - text: "Второй сервер поднят на 3081; в нём созданы свежие сессии gatherer и reviewer (agent-preset/selected = gatherer/reviewer), плюс одна свежая native-сессия backend как контроль"
    done: false
  - text: "В журнале каждой PTC-сессии request/header содержит ровно один инструмент run_code; system/message содержит «Writing code for run_code» и объявления инструментов пресета; есть события tool/ptc-dispatch; ассистент не получил INVALID_REQUEST или CODE_RUN_FAILED"
    done: false
  - text: "Задачи выполнены и ответы проверены независимо: gatherer — отчёт по файлам (число регистраций инструментов в plugins/taskboard/taskboard.mjs, строка функции apply в plugins/outline/outline.mjs, число каталогов плагинов с package.json); reviewer — `node scripts/outline-selftest.mjs` и его verdict/exit code плюс два preset id с tool-executor-ptc"
    done: false
  - text: "Контроль: свежая backend-сессия видит много инструментов (не run_code) — остальные пресеты остались native; :3080 не перезапускался и его установленный профиль не менялся"
    done: false
  - text: "После проверки процесс 3081 остановлен по командной строке, временные слои и лишние сессии убраны; evidence (логи, снимки, FINDINGS.md) лежит в reports/ptc-wave1/"
    done: false
  - text: "Итоговый отчёт: id сессий, число инструментов в шапке каждой, число вложенных вызовов, ответы, любые расхождения с этими критериями"
    done: false
boardId: task-mwkk3shd-vpgj4y
nonScope: ["живой :3080 и его установленный профиль — не перезапускать, не редактировать", "profile/cordis.patch.yml — только читать, не менять", "plugins/ — не менять", "kit-update --apply — не запускать"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 9f9ba103-cddd-4b9b-9a1c-14c648707ccc
ownerRole: BACKEND
preset: backend
resultEvidence: ["reports/ptc-wave1/dump-config.txt: tool-executor-ptc на 1908 (gatherer) и 1992 (reviewer), хостовый ряд 448 disabled: true", "reports/ptc-wave1/sessions/session-0e462b5d.../session.jsonl: header tools [run_code], SDK 54, dispatch 6, ответ 12/429/24", "reports/ptc-wave1/sessions/session-63c7ae55.../session.jsonl: header tools [run_code], SDK 59, dispatch 5, PASS 6/0 exit 0", "reports/ptc-wave1/sessions/session-511ea4b6.../session.jsonl: header 91 инструментов, run_code нет", "ss -ltn: слушает только :3080; :3080 pid 3160705 старт 12:22; установленный профиль mtime 12:22", "node scripts/outline-selftest.mjs → verdict PASS 6/0, exit 0; grep -c = 12; grep -n apply = 429; 24 package.json"]
resultSummary: "Проверено независимо по копиям журналов: gatherer и reviewer в свежих сессиях видят ровно один run_code, SDK 54/59 инструментов, 6/5 вложенных вызовов, ответы совпали с независимой проверкой; контроль backend native — 91 инструмент, run_code нет; :3080 не перезапускался, :3081 остановлен. Уточнение: в PTC-SDK нет mcp__playwright__* (вопреки формулировке в FINDINGS); 24 MCP-инструмента есть только в контрольной native-сессии, это поведение tool-families при выборе пресета после создания сессии, не PTC."
role: BACKEND
scope: ["второй web-сервер на порту 3081 с временным слоем настроек", "свежие сессии gatherer, reviewer и одна native-сессия backend для контроля", "чтение журналов сессий и снимки экрана в reports/ptc-wave1/"]
---

Доказать на втором web-сервере со свежими сессиями, что пресеты gatherer и reviewer из profile/cordis.patch.yml работают в PTC-режиме: шапка из одного run_code, SDK со всеми инструментами пресета, вложенные вызовы tool/ptc-dispatch, корректный результат, без INVALID_REQUEST и CODE_RUN_FAILED. Остальные пресеты должны остаться native. Живой :3080 и установленный профиль не трогать.

Migrated from .dsh/taskboard.json (task task-mwkk3shd-vpgj4y, revision 7).
