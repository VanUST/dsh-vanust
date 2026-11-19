---
id: TASK-225
kind: task
title: "V3.2: L1 показывает открытые REQ и разрывы реестра (BR1, третья точка)"
status: done
revision: 3
createdAt: 2026-11-17T16:29:11.872Z
updatedAt: 2026-11-17T16:29:11.872Z
acceptance:
  - text: "`state/views/digest.md` получает две секции: «открытые REQ» — id требований в статусах proposed/accepted/in_progress, детерминированно отсортированные и ограниченные (до 20), и «разрывы» — REQ без задач (id, до 10) с общим счётчиком, TASK без reqId (счётчик), TEST без reqId (счётчик)"
    done: false
  - text: "Digest остаётся в пределах 3072 байт и регенерируется байт-в-байт детерминированно (два прогона — одинаковые хеши)"
    done: false
  - text: "Живая сессия на копии реального `state/` (headless + оверлей, как в V3.1): в L1-сообщении видны и открытые REQ по id, и строка про разрывы; ответ модели называет открытые требования и разрывы БЕЗ bash-чтения state/ (проверить по журналу: нет вызовов bash для этого)"
    done: false
  - text: "`make verify` exit 0; перепаковка затронутых плагинов"
    done: false
boardId: task-mwkwlg2r-qktas2
nonScope: ["миграция связей reqId (проставление старым задачам) — отдельное решение владельца", "правка панели и designmap", "живой :3080; state/ в репозитории не менять, работать на копии"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["digest 2655 Б ≤ 3072 с ## Gaps и ## Open requirements (6), sha256 одинаков в двух прогонах", "L1 seq 10 (2564 Б) содержит обе секции; ответ seq 31 называет те же 6 REQ и три разрыва", "0 tool/call и 0 bash в журнале — ответ целиком из L1", "project-state 12/12, state-feed 6/6; тарбол project-state 0.1.6"]
resultSummary: "Третья точка BR1 закрыта: digest получил секции «Gaps» (REQ без задач с id, TASK без reqId, TEST без reqId) и «Open requirements» (до 20 id со статусами), уложился в 2655 из 3072 байт и детерминирован. Живая сессия отвечает по L1 без единого вызова инструмента: 0 tool/call, 0 bash."
role: BACKEND
---

Закрыть третью точку BR1: L1 должен сам показывать разрывы и состав открытых требований, а не только счётчики. Сейчас digest даёт «REQ 102 · TASK 223 · TEST 49», а про REQ без задач, TASK без reqId и TEST без reqId молчит, поэтому модель добывала ответ bash-чтением файлов. Добавь в digest две детерминированные секции: открытые REQ по id (bounded) и разрывы (REQ без задач с id, задачи без reqId, кейсы без reqId), уложись в кап 3072 байта, и докажи на живой сессии, что ответ называется из L1 без обхода файловой системой.

Migrated from .dsh/taskboard.json (task task-mwkwlg2r-qktas2, revision 5).
