---
id: TASK-246
kind: task
title: "Ручной статус задачи в панели Project state и доска без предела строк"
status: done
revision: 4
createdAt: 2026-11-19T08:20:01.121Z
updatedAt: 2026-11-19T08:48:19.484Z
acceptance:
  - text: "cмена статуса на доске панели меняет .dsh/taskboard.json, state/task/<id>.md и state/views/index.json, событие в state/events.jsonl есть"
    done: false
  - text: "без maxRows доска принимает строку 1001+, явный maxRows отказывает board_rows_full"
    done: false
  - text: "отказ в панели показан кодом, панель не использует workspaceFiles.write"
    done: false
  - text: "тесты красные на HEAD и зелёные после, make verify зелёный, браузерный прогон на втором сервере"
    done: false
  - text: "README/кейсы/docs обновлены под новое поведение"
    done: false
boardId: task-mwna53jt-817kmc
inline: true
reqIds: [REQ-136, REQ-137, REQ-138, REQ-146]
resultEvidence: ["node --test plugins/taskboard/test/owner-status.test.mjs (0.1.66): 5 из 6 падают, code unknown_op — красный; на 0.1.67: 6/6 pass, TEST-072", "PANEL_ROOT=<shipped 0.1.36 client> node --test plugins/project-state-panel/test/counts-and-sort.test.mjs: падает, называя отсутствие requirementIdsOf/taskStatusRequest/changeTaskStatus, один call site команд и отсутствие контрола статуса; на 0.1.38 pass, TEST-074", "node --test plugins/project-state/test/service.test.mjs (0.1.13): 'the service publishes no journal()' — красный; на 0.1.14 pass, TEST-075", "node --test plugins/taskboard/test/*.test.mjs plugins/project-state/test/*.test.mjs plugins/project-state-panel/test/*.test.mjs: 33/33 pass", "node scripts/taskboard-limit-proof.mjs: 13/13, явный maxRows:10 отказывает board_rows_full, maxRows:0 принимает строку на полной доске, TEST-073", "второй сервер :3081 (изолированный DSH_HOME, профиль web-proof с panel 0.1.38): 11/11 браузерных проверок; TASK-246 open -> done из списка и с карточки; reports/task-state-owner-control/screens/ и fixture-after.json: доска done rev 3 с записью {kind: status, actor: human, from: open, to: done}, state/task/TASK-246.md done, index.json done, одно событие owner_status_override {boardId, taskId}", "негативный контроль: TASK-990 без boardId — отказ no_board_row, 0 команд, 0 событий журнала, файл open", "replay() на рабочем пространстве: ok true, 982 события, 0 расхождений; verify() без новых кодов; index.json schemaVersion 1", "make verify: portability 17/17, documentation ok, glossary ok, schema-lint ok, context-budget 0 red, harness-identity-guard patched"]
resultSummary: "Владелец может менять статус любой задачи прямо в панели Project state — в списке (вид по умолчанию), на карточке доски и в карточке-панели задачи. Изменение идёт командой /taskboard op owner-status через доску задач: CAS по ревизии строки, обход правил жизненного цикла, остановка детей при done/cancelled, зеркало в TASK, событие owner_status_override в журнале состояния. Отказ называется кодом (stale, no_board_row, command_unavailable). Доска задач больше не имеет предела строк по умолчанию: maxRows — только явная настройка (0 = без предела), профиль её не задаёт. Отдельно исправлено: задача с reqIds показывает все связанные требования в карточке, карточке-панели, фильтре и счётчике (раньше — «no requirement» при двух требованиях на доске). Пакеты: taskboard 0.1.67, project-state 0.1.14, project-state-panel 0.1.38."
steps: ["taskboard: предел строк по умолчанию отсутствует (maxRows — явная настройка, 0 — без предела), профиль не задаёт maxRows; тест red→green", "taskboard: операция owner-status (CAS, обход transitionRefusal, остановка детей, таймлайн, журнал состояния) и хук журнала; тест red→green", "project-state: journal() в сервисе ccProjectState; тест", "project-state-panel: управление статусом на доске и в карточке, команда, отказ кодом, перечитывание index.json; тест red→green", "Документация: README трёх плагинов, решение в docs/design, кейсы read-only обновлены", "Пакеты пересобраны и установлены на втором сервере; браузерное доказательство смены статуса и отказа; make verify"]
stepsDone: 6
---

Владелец получает в панели Project state ручное управление статусом задачи (доска и карточка): изменение идёт командой /taskboard op owner-status через доску задач, обходит правила жизненного цикла, останавливает детей при done/cancelled и оставляет событие в журнале состояния; доска задач больше не имеет предела строк по умолчанию. Всё доказано тестами red→green, прогоном на втором сервере и в браузере, make verify зелёный.
