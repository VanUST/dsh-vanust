---
id: TASK-248
kind: task
title: "Статус меняется кликом по значку, без второй плашки"
status: done
revision: 3
createdAt: 2026-11-19T10:36:38.127Z
updatedAt: 2026-11-19T10:46:01.055Z
acceptance:
  - text: "на доске (сетка), в списке и в карточке-панели статус меняется кликом по самому значку; второй плашки нет"
    done: false
  - text: "тест panel зелёный на 0.1.40 и красный на 0.1.38 (находит вторую плашку)"
    done: false
  - text: "браузерный прогон на втором сервере: смена статуса кликом по значку меняет доску, TASK и журнал"
    done: false
  - text: "README/PROOF обновлены, make verify зелёный"
    done: false
boardId: task-mwnf0r0k-mneo73
inline: true
reqIds: [REQ-136]
resultEvidence: ["PANEL_ROOT=<клиент 0.1.38> node --test plugins/project-state-panel/test/counts-and-sort.test.mjs: падает с 'the status badge is not a control', 'a second status control duplicates the badge', 'the drawer badge carries no optional reason field'; на 0.1.40 pass", "второй сервер :3081 (изолированный DSH_HOME, профиль web-proof, панель 0.1.40), proof-badge.mjs: 17/17 — 249 строк и 249 значков, 249 карточек и 249 значков, у строки TASK-248 ровно один контрол, в карточке-панели нет формы 'Change the status'", "там же: TASK-248 open -> done кликом по значку в списке, TASK-243 -> done с карточки, TASK-233 open -> blocked с причиной 'owner set it aside' из карточки-панели", "reports/task-state-owner-control/screens/21..25.png; доска: {kind: status, actor: human, from, to}, index.json совпадает; 3 события owner_status_override, у TASK-233 причина записана; TASK-990 без boardId — no_board_row, 0 событий", "node --test plugins/taskboard/test/*.test.mjs plugins/project-state/test/*.test.mjs plugins/project-state-panel/test/*.test.mjs: 33/33 pass", "make verify: 17/17 portability, documentation ok, glossary ok, schema-lint 0 red, identity-guard patched, exit 0", "пакет plugins/cc-dsh-project-state-panel-0.1.40.tgz (sha256 e887f187…→ новый), README и reports/task-state-owner-control/PROOF.md обновлены"]
resultSummary: "Отдельная плашка статуса убрана: значок статуса сам является выпадающим списком — нативный select в виде чипа с кареткой из CSS. Он стоит в списке задач, внизу карточки доски (заголовок сохраняет всю ширину) и в шапке карточки-панели; рядом в карточке-панели осталось только необязательное поле «why?», которое уходит в журнал. Старая форма «Change the status» и второй select удалены. Панель 0.1.40; тест красный на 0.1.38 и зелёный на 0.1.40, браузерный прогон 17/17 на втором сервере."
steps: ["панель: StatusSelect — значок статуса как нативный select в списке, на карточке доски и в карточке-панели; убрать TaskStatusEditor и отдельный select", "карточка-панели: необязательное поле «почему» рядом со значком", "тест панели: красный на 0.1.38 (вторая плашка), зелёный на 0.1.39", "README/PROOF обновлены, пакет 0.1.39, браузерное доказательство на втором сервере, make verify"]
stepsDone: 4
---

Убрать вторую плашку статуса в панели Project state: значок статуса сам становится выпадающим списком (нативный select в виде чипа) в списке задач, на карточке доски и в карточке-панели; в карточке-панели рядом остаётся только необязательное поле «почему». Доказать тестом red→green и браузерным прогоном на втором сервере.
