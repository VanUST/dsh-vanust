---
id: TASK-232
kind: task
title: "P2: правая колонка панели, верхняя панель без Tasks и Design map"
status: done
revision: 4
createdAt: 2026-11-18T12:26:55.696Z
updatedAt: 2026-11-18T12:27:05.889Z
acceptance:
  - text: "Кнопка правой колонки убирает ps-rail из разметки и возвращает её; aria-pressed и aria-label меняются"
    done: false
  - text: "Верхняя панель: в клиентах taskboard и designmap нет регистраций conversation.session.header.actions; регистрации в main сохранены"
    done: false
  - text: "client.js designmap пересобран из entry.jsx, а не правился руками"
    done: false
  - text: "Обновлённый panel-navigation.test.mjs: зелёный на текущих файлах (exit 0, violations 0) и красный на версиях из git HEAD (exit 1 с названными нарушениями)"
    done: false
  - text: "Три новых кейса (REQ-108/109/110) записаны с testPath, exact runCommand, checks violations == 0, negativeControl expect-pre-fix, linkedTaskId этой задачи, статус verified после пары красный→зелёный"
    done: false
  - text: "Четыре старых кейса перепрогнаны после изменения теста и не числятся устаревшими"
    done: false
  - text: "Пересобраны ровно три тарбола; соседние тарболы на месте (проверить ls plugins/*.tgz до/после)"
    done: false
  - text: "make verify — exit 0, 17/17 + документация"
    done: false
boardId: task-mwm3irxo-x6slzr
nonScope: ["живой сервер :3080 и установленный профиль — не останавливать, не перезапускать, не менять", "docs/analysis/*.json — записи анализа правит только оркестратор", "state/ — проекции генерируются ядром, руками не править", "другие плагины и их тарболы", "браузерное доказательство — его снимет оркестратор на втором сервере"]
owner:
  kind: agent
  label: BACKEND
  sessionId: c787734e-ad4b-41fc-a357-2c496af2e4d4
preset: backend
reqIds: [REQ-108, REQ-109, REQ-110]
resultEvidence: ["panel-navigation.test.mjs: зелёный exit 0 / violations 0; на git HEAD exit 1 / violations 13; контроль expect-pre-fix exit 1 / violations 6 — reports/p2/backend/green.log, red-on-head.log, red-control.log", "браузер :3097 (копия профиля, панель 0.1.20): Tasks=0, Design map=0, State=1; .ps-rail 1/360px → 0/0 → 1/360; aria-pressed false→true→false; axe 0; 760px scrollW=clientW; консоль/сеть 0 — reports/p2/proof-p2.json + rail-before/hidden/restored.png", "кейсы state-panel-right-column-toggles (REQ-108), session-header-drops-the-tasks-button (REQ-109), session-header-drops-the-design-map-button (REQ-110): red exit 1 → green exit 0, verified, linkedTaskId task-mwm3irxo-x6slzr; четыре старых перепрогнаны", "пересобраны ровно три тарбола: taskboard 0.1.61, project-state-panel 0.1.20, designmap 0.1.22 (25 до / 25 после, изменены три строки)", "make verify: exit 0, 17/17 + documentation ok — reports/p2/backend/verify.log", "docs/analysis/shell-panel-navigation.json rev 8: 6 proven, 1 rejected, completion ok"]
resultSummary: "Правая колонка панели состояния скрывается и возвращается кнопкой (railOpen, aria-pressed, подписи «Скрыть/Показать правую колонку»); верхняя панель сессии больше не показывает Tasks и Design map (регистрации conversation.session.header.actions удалены из клиентов taskboard и designmap, панели в main сохранены). Три тарбола пересобраны, три кейса REQ-108/109/110 прошли red→green, четыре старых перепрогнаны, make verify 17/17. Браузерное доказательство снято оркестратором на втором сервере :3097."
role: BACKEND
scope: [plugins/project-state-panel/client.js, plugins/taskboard/client.js, plugins/taskboard/test/panel-navigation.test.mjs, plugins/designmap/client/entry.jsx, "plugins/designmap/client.js (пересборка из entry.jsx)", "plugins/designmap/build-client.mjs (только запуск)", "docs/cases/ (новые кейсы + прогоны старых)", "plugins/cc-dsh-taskboard-*.tgz, plugins/cc-dsh-project-state-panel-*.tgz, plugins/cc-dsh-designmap-*.tgz", "reports/ (артефакты прогонов)"]
steps: ["Правая колонка: состояние railOpen, кнопка скрывает/возвращает ps-rail, aria-pressed и подпись", "taskboard: удалить регистрацию TasksTrigger, оставить main", "designmap: удалить регистрацию HeaderTrigger из entry.jsx и пересобрать client.js", "Обновить panel-navigation.test.mjs под новую форму", "Красный прогон на HEAD → зелёный на текущих; записать 3 кейса, перепрогнать 4 старых", "Пересобрать 3 тарбола с проверкой соседей и make verify"]
stepsDone: 0
---

Панель состояния получает рабочую кнопку правой колонки: нажатие убирает колонку доказательств, повторное — возвращает, кнопка отражает состояние (aria-pressed, подпись). Верхняя панель сессии перестаёт показывать старые входы: из клиента taskboard удаляется регистрация TasksTrigger в conversation.session.header.actions, из клиента designmap — HeaderTrigger «Design map»; обе панели остаются зарегистрированными в main. Статический тест panel-navigation.test.mjs обновляется под новую форму, для каждого требования записывается кейс с парой красный→зелёный, старые четыре кейса перепрогоняются, три тарбола пересобираются, make verify — 17/17.
