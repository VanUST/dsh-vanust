---
id: TASK-234
kind: task
title: "P3: счётчики State и список задач с сортировкой"
status: done
revision: 4
createdAt: 2026-11-18T12:29:55.544Z
updatedAt: 2026-11-18T12:39:14.133Z
acceptance:
  - text: "Кнопка State в шапке показывает три числа (невыполненные/активные задачи/активные субагенты) с aria-label, нулями и «—» при ошибке чтения; числа обновляются без перезагрузки"
    done: false
  - text: "В режиме Board появился переключатель Board/List; List показывает таблицу Status/Task/Requirement/Progress/Updated"
    done: false
  - text: "Теги сортировки Relevance (по умолчанию), Updated, Status, Title с aria-pressed; Relevance-порядок соответствует решению D3"
    done: false
  - text: "axe 0 по панели, клавиатурная доступность переключателя и тегов, 760 px без горизонтальной прокрутки"
    done: false
  - text: "Кейсы на REQ-115/116/117 с красным→зелёным и linkedTaskId этой задачи, тарбол пересобран, make verify exit 0"
    done: false
boardId: task-mwm3mmo3-08soxt
nonScope: ["живой :3080 и установленный профиль — не трогать", "docs/analysis/*.json — правит только оркестратор", "state/views и state/task — только чтение, никаких записей", "панель Tasks и designmap (там идёт P2)", "приоритет задачи: в проекциях его нет, сортировка по нему не делается"]
owner:
  kind: agent
  label: BACKEND
  sessionId: c787734e-ad4b-41fc-a357-2c496af2e4d4
preset: backend
reqIds: [REQ-115, REQ-116, REQ-117]
resultEvidence: ["counts-and-sort.test.mjs: зелёный exit 0 / violations 0; снимок client.js до правки (HEAD 135176a) exit 1 / violations 1; контроль expect-pre-fix exit 1 / violations 3 — reports/p3/backend/green.log, red-on-head.log, red-control.log", "браузер :3097 (панель 0.1.21): «State 74 / 5 / 0» + aria-label с названной областью; Board/List с aria-pressed; теги Relevance (по умолчанию)/Updated/Status/Title; таблица Status/Task/Requirement/Progress/Updated, 223 строки; Relevance: active TASK-223/202/184/113/094 → review TASK-111; axe 0; 760px scrollW=clientW; консоль/сеть 0 — reports/p3/proof-p3.json + header-counters.png, list-relevance.png", "кейсы state-header-shows-three-counters (REQ-115), board-list-sorts-tasks (REQ-116), counters-and-list-stay-read-only (REQ-117): red exit 1 → green exit 0, verified, linkedTaskId task-mwm3mmo3-08soxt; пять кейсов панели перепрогнаны", "тарбол project-state-panel 0.1.21 (0.1.20→0.1.21, 25→25 файлов, изменена одна строка)", "make verify: exit 0, 17/17 + documentation ok — reports/p3/backend/verify.log", "docs/analysis/state-counts-and-task-list.json rev 3: 3 proven, completion ok"]
resultSummary: "Кнопка State показывает три счётчика (невыполненные/активные задачи/активные субагенты) с названной областью счёта и обновлением без перезагрузки; в режиме Board появился переключатель Board/List, а List — таблица Status/Task/Requirement/Progress/Updated с тегами сортировки Relevance (по умолчанию)/Updated/Status/Title. Чистые функции покрыты тестом с красным до правки, три кейса verified, тарбол 0.1.21, make verify 17/17; браузерное доказательство снято оркестратором на :3097."
role: BACKEND
scope: [plugins/project-state-panel/client.js, "plugins/project-state-panel/test/ (новый тест чистых функций счёта и сортировки)", "docs/cases/ (кейсы REQ-115/116/117)", "plugins/cc-dsh-project-state-panel-*.tgz", "reports/ (артефакты)"]
steps: ["Вынести чистые функции: счётчики (невыполненные/активные/субагенты) и компаратор Relevance + теги", "Триггер State: счётчики с aria-label, обновление по сессиям и проекциям, «—» при ошибке", "Board: переключатель Board/List, таблица списка, теги сортировки с aria-pressed", "Тест чистых функций + кейсы red→green; axe/клавиатура/760px", "Пересобрать тарбол, make verify"]
stepsDone: 0
---

В @cc/dsh-project-state-panel: (FR1) триггер State в conversation.session.header.actions показывает рядом с иконкой три числа — невыполненные задачи, активные задачи, активные субагенты — из проекций workspace и живых дочерних сессий текущего чата, с пересчётом без перезагрузки и названной областью счёта; (FR2) в режиме Board появляется переключатель Board/List, а в List — таблица задач с колонками Status/Task/Requirement/Progress/Updated и тегами сортировки Relevance (по умолчанию), Updated, Status, Title. Relevance: active → blocked → review → open → done → cancelled; внутри — больше выполненных шагов, затем updatedAt по убыванию, затем id. Только чтение, без записей. Тест на чистых функциях сортировки/счёта + кейсы с красным→зелёным; тарбол пересобрать, make verify 17/17.
