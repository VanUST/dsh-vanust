---
id: TASK-347
kind: task
title: "Отказ `dependency_open`: доска держит порядок шагов"
status: done
revision: 10
createdAt: 2026-11-27T14:02:00.740Z
updatedAt: 2026-11-27T14:13:47.583Z
acceptance:
  - text: "Задача с `dependsOn`, где зависимость ещё не done, не переходит в active и не создаётся сразу active: отказ `dependency_open`, в тексте — id задачи, которой она ждёт (цитата вывода)."
    done: false
  - text: "После завершения зависимости тот же переход проходит (цитата)."
    done: false
  - text: "Тест `plugins/taskboard/test/dependency-open.test.mjs` написан первым и КРАСНЫЙ на текущем коде (цитата падения), зелёный после правки."
    done: false
  - text: "Переходы без `dependsOn` ведут себя как раньше: существующие тесты taskboard зелёные, make verify exit 0."
    done: false
  - text: "`delegate_task` пробрасывает этот отказ (проверить, что он не проглатывается и не превращается в общий блок): если проглатывает — поправить в orchestrator.mjs минимально и описать."
    done: false
  - text: "Отказ называет виновника как `scope_overlap` и `devops_lane_busy`: код + имя задачи."
    done: false
boardId: task-mwz1vojd-oatvyh
nonScope: ["Не трогать текст ROOT_POLICY — правило пишет оркестратор в отдельной задаче.", "Не трогать docs/ и rules/.", "Не пересобирать плагины — пересборка отдельной задачей."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-274]
resultEvidence: ["Красный до: «an open dependency must refuse the start: {ok:true,…,status:active,dependsOn:[task-deploy]}»; после правки 7/7, включая отказ linkChild и проброс кода из delegate_task.", "Продуктовый прогон через инструменты: создана задача с dependsOn=[task-deploy] → отказ `dependency_open: \"…\" waits for \"task-deploy\"`, статус остался open; после done — active.", "Обнаружен и исправлен более глубокий дефект: TASK_UPDATE_FIELDS не содержал dependsOn, поэтому объявленное поле возвращало ok:true и не писалось; теперь поле в обеих схемах и в списке, тест держит их вместе в обе стороны.", "taskboard 65 pass / 0 fail, orchestrator 39 pass / 0 fail; make verify 20/20 exit 0 после пересборки (TASK-348)."]
resultSummary: "Доска держит порядок: задача с открытой зависимостью не стартует и не получает ребёнка — отказ `dependency_open` называет ожидаемую задачу, delegate_task возвращает код и имя. Зависимость теперь можно поставить из инструментов: поле проведено в схемы task_create/task_update и в белый список (до этого объявленное поле молча не писалось). Тест красный-до/зелёный-после 7/7, продуктовый прогон с отказом и последующим active."
role: BACKEND
scope: [plugins/taskboard/taskboard.mjs, plugins/taskboard/test/dependency-open.test.mjs, plugins/orchestrator/orchestrator.mjs]
---

Поле `dependsOn` на доске только хранится: ни создание, ни переход в active, ни delegate_task не смотрят на него, поэтому «тест после выкатки» держится на памяти оркестратора. Сделайте порядок механическим: задача с открытой зависимостью не запускается, отказ называется `dependency_open` и называет задачу, которой ждёт; после её завершения переход проходит. Одна точка правды — `transitionRefusal` плюс путь создания активной задачи. Тест красным-до/зелёным-после.
