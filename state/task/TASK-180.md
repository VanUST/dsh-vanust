---
id: TASK-180
kind: task
title: "Native→PTC: что происходит со старой сессией после рестарта"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.601Z
updatedAt: 2026-11-17T15:52:41.601Z
acceptance:
  - text: "Созданы две сессии gatherer и reviewer на :3081 БЕЗ PTC-слоя (native), в каждой выполнен первый ход с результатом, который можно проверить во втором ходе"
    done: false
  - text: "Сервер остановлен, поднят заново с Wave 1 слоем; обе сессии возобновлены в том же id и получили второй запрос, зависящий от первого ответа"
    done: false
  - text: "В журнале показано, какая шапка была у первого запроса после возобновления: native-набор или один run_code; есть ли agent-preset/selected и developer/message с добавлением/удалением инструментов"
    done: false
  - text: "Следующий запрос принят: INVALID_REQUEST и CODE_RUN_FAILED равны 0; второй ответ корректен и опирается на первый; сессия не потеряла историю"
    done: false
  - text: "Измерена цена первого шага после переключения: inputTokens и cacheReadTokens; если переключения нет — шапка native и это тоже доказано"
    done: false
  - text: "Дана процедура безопасного перезапуска :3080: когда перезапускать, что будет со старыми сессиями, как проверить первую возобновлённую сессию, что делать при отказе; отдельно — что будет с активной работой (турн прерывается рестартом, сессия и таскборд переживают)"
    done: false
  - text: "Отчёт: id сессий, шапки до/после, ответы, ошибки, цена, процедура; evidence в reports/ptc-resume/"
    done: false
boardId: task-mwkknas8-9txqhd
nonScope: ["живой :3080 — не перезапускать, не редактировать", "установленный профиль $DSH_HOME/profiles/web/cordis.patch.yml — не менять", "profile/cordis.patch.yml и plugins/ — не менять", "kit-update --apply — не запускать"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 9f9ba103-cddd-4b9b-9a1c-14c648707ccc
ownerRole: BACKEND
preset: backend
resultEvidence: ["reports/ptc-resume/sessions/session-8a4fa656.../session.jsonl: header 83 → [run_code], dev 84, usage 31393/5376, ответы 24/31/# dsh-kit", "reports/ptc-resume/sessions/session-1670f09a.../session.jsonl: header 89 → [run_code], dev 90, usage 32844/5376, ответы 6/66", "reports/ptc-resume/FINDINGS.md §5: процедура перезапуска и проверки", "ss -ltn: только :3080; :3080 pid 3160705 старт 12:22; установленный профиль mtime 12:22", docs/cases/native-to-ptc-resume-switches-and-is-accepted.json]
resultSummary: "Проверено независимо по копиям журналов: до рестарта шапки 83/89, после возобновления — один run_code; developer/message 84/90 частей (1 добавление + 83/89 удалений); INVALID_REQUEST/CODE_RUN_FAILED нет; ответы 24→31 и 6→66; первый шаг 31 393/32 844 input и 5 376 cacheRead, следующий снова кэширован. :3080 жив, :3081 остановлен, установленный профиль не менялся."
role: BACKEND
scope: ["второй web-сервер :3081 с установленным профилем и временным PTC-слоем", "сессии gatherer и reviewer, созданные ДО переключения, затем возобновлённые ПОСЛЕ перезапуска", "чтение журналов, снимки, отчёт в reports/ptc-resume/"]
---

Установить измерением, что происходит со старой native-сессией gatherer/reviewer после перезапуска сервера с PTC-пресетом и возобновления: переключается ли она на PTC, принимается ли следующий запрос (нет INVALID_REQUEST), продолжается ли работа и сколько стоит первый шаг. Дать процедуру безопасного перезапуска :3080.

Migrated from .dsh/taskboard.json (task task-mwkknas8-9txqhd, revision 7).
