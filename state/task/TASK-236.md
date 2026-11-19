---
id: TASK-236
kind: task
title: "State: конкретика задачи в TASK и переход к сессии субагента"
status: done
revision: 11
createdAt: 2026-11-18T13:47:21.171Z
updatedAt: 2026-11-18T14:59:13.109Z
acceptance:
  - text: "state/task/*.md несёт scope, nonScope, acceptance [{text,done}], role/preset/owner, sessions [{sessionId,label,role,status}] и итог, а body остаётся целью"
    done: false
  - text: "Зеркало пишет эти поля в тот же TASK по boardId на create/update/linkChild; старый TASK без полей остаётся валидным"
    done: false
  - text: "state-migrate --refresh-tasks заполняет существующие TASK и повторный прогон не меняет байты"
    done: false
  - text: "В карточке задачи панели State видны цель, рамки, вне рамок, критерии, шаги и сессии; Open вызывает uiWorkspace.openSession(sessionId)"
    done: false
  - text: "Панель различает цветом статусы задач/REQ/TEST и типы сущностей (active и review — разные цвета, open не бесцветен), список задач показывает живых субагентов отдельно от статуса"
    done: false
  - text: "Первый рендер панели читает только index.json; тело сущности — при открытии карточки, записи анализа — при первом открытии Design map; средняя кнопка закрытия правой панели удалена"
    done: false
  - text: "Тесты project-state, taskboard и project-state-panel зелёные; пересобраны три тарбола; make verify exit 0"
    done: false
boardId: task-mwm6e79r-1swk9g
owner:
  kind: agent
  label: CRITIC
  sessionId: 453c4c9c-17f6-4a28-8389-5cca2b2f3339
preset: critic
reqIds: [REQ-124, REQ-125, REQ-126, REQ-127]
resultEvidence: ["node --test plugins/project-state/test/*.test.mjs plugins/taskboard/test/*.test.mjs plugins/project-state-panel/test/*.test.mjs plugins/delegation-brief/test/*.test.mjs -> 33 pass, 0 fail", "make verify -> exit 0, 17/17 portability and packaging checks", "red on HEAD source (hardlink copy): core 2 fail (concrete fields, quoted inline list), taskboard 2 fail (concrete+sessions, liveness); green on 0.1.12/0.1.64; TEST-067..TEST-070 carry the red→green pairs", "CRITIC verification: 24/24 tests, make verify 17/17, FR1/FR2/FR3/NFR1 measured on temp workspaces, index-first first paint reads exactly state/views/index.json and the drawer reads one entity file; it also found and I fixed the unmirrored close/childEnded and the lease donor", "load benchmark: first paint 3 index page reads (164 KB, 5271 lines) vs the old 1 + ~430 entity reads + analysis; drawer body one file read", "installed in ~/.npm/dsh/profiles/web: project-state 0.1.12, project-state-panel 0.1.27, taskboard 0.1.64, delegation-brief 0.1.5"]
resultSummary: "Состояние: TASK в state/task несёт конкретику задачи (scope, nonScope, acceptance, role/owner, sessions, result), зеркало пишет её на create/update/linkChild/close/cancel/childEnded/reconcile и очищает донора при передаче ребёнка; панель показывает карточку с целью/рамками/критериями/шагами, сессии с Open через uiWorkspace.openSession, живых субагентов отдельно от статуса (running/idle, N running/N idle), цвета по статусам и типам, пустой правый рельс по умолчанию, список — режим по умолчанию, без средней кнопки; первый рендер читает один index.json (list-поля), тело и анализ — по требованию; миграция дополнена --refresh-tasks и --sync-status; делегационный бриф принимает реально существующие статусы REQ."
role: CRITIC
sessions:
  - sessionId: 453c4c9c-17f6-4a28-8389-5cca2b2f3339
    label: CRITIC
    role: CRITIC
    status: sleeping
steps: ["Ядро: поля TASK (scope, nonScope, acceptance, role/preset/owner, sessions, result) в create/update и replay", "Зеркало: taskPayload пишет конкретику и sessions; linkChild зеркалит задачу", "Миграция: state-migrate --refresh-tasks обновляет существующие TASK", "Панель: карточка задачи с конкретикой и кнопкой Open сессии субагента", "Тесты трёх плагинов red→green; тарболы; make verify"]
stepsDone: 4
---

В @cc/dsh-project-state (ядро) расширить схему TASK аддитивными полями задачи из панели Tasks — scope, nonScope, acceptance [{text,done}], role/preset/owner, sessions [{sessionId,label,role,status}], resultSummary/resultEvidence; в @cc/dsh-taskboard (mirror) писать их при create/update/linkChild; в scripts/state-migrate.mjs добавить --refresh-tasks для существующих TASK по boardId. В @cc/dsh-project-state-panel карточка задачи показывает цель, рамки, вне рамок, критерии приёмки, шаги, роль/владельца и сессии, у каждой сессии — кнопка Open, открывающая сессию через uiWorkspace.openSession. Панель остаётся только для чтения. Покрыть тестами ядро, зеркало и панель, пересобрать три тарбола, make verify.
