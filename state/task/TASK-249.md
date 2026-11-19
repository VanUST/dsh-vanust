---
id: TASK-249
kind: task
title: "Скрыть chore-задачи из вида доски задач"
status: done
revision: 3
createdAt: 2026-11-19T11:27:23.211Z
updatedAt: 2026-11-19T11:32:37.918Z
acceptance:
  - text: "переключатель Hide chores есть в подшапке доски в обоих видах, с aria-pressed и числом chore"
    done: false
  - text: "при включении chore-задачи уходят из списка и с колонок доски, счётчик равен видимым строкам"
    done: false
  - text: "по умолчанию chore видны, state/ и index.json не меняются"
    done: false
  - text: "тест красный на 0.1.40 и зелёный на 0.1.41; браузерный прогон на втором сервере; make verify зелёный"
    done: false
boardId: task-mwngu1cv-x700vf
inline: true
reqIds: [REQ-147]
resultEvidence: ["PANEL_ROOT=<клиент 0.1.40> node --test plugins/project-state-panel/test/counts-and-sort.test.mjs: падает с 'the panel exports no isChoreTask', 'the board subbar has no hide-chores toggle', 'the hide-chores toggle does not reflect its state through aria-pressed', 'the board/list does not filter chore tasks from the view'; на 0.1.41 pass", "второй сервер :3081 (изолированный DSH_HOME, профиль web-proof, панель 0.1.41), proof-hide-chores.mjs: 11/11 — 249 строк и 3 chore по умолчанию, 246 строк и 0 chore после нажатия (счётчик 246 tasks), 246 карточек в сетке, все chore вернулись после повторного нажатия", "state/ и .dsh/taskboard.json байт-в-байт совпадают до и после переключений (b568764b397e…, f4f17f9436a5…): скрытие ничего не пишет", "reports/state-panel-hide-chores/PROOF.md и screens/31..34.png", "node --test трёх плагинов: 33/33 pass; make verify exit 0 (17/17 portability, documentation ok, glossary ok, schema-lint 0 red)", "TEST-076 записан с парой panel-0.1.40:red:fail / panel-0.1.41:green:pass и связан с TASK-249; запись анализа state-panel-hide-chores завершена (1 proven)"]
resultSummary: "В подшапке доски появился один переключатель Hide chores (N): N — число chore-задач в текущем фильтре требований. Нажатие убирает chore-задачи из списка и из колонок доски, счётчик задач показывает видимые строки; повторное нажатие возвращает их. По умолчанию всё как раньше; если фильтр оставляет только chore, панель говорит это текстом и предлагает Show chores. Это настройка вида: state/, index.json и .dsh/taskboard.json не пишутся (sha256 до и после совпал). Панель 0.1.41; тест красный на 0.1.40 и зелёный на 0.1.41, браузерный прогон 11/11."
steps: ["панель: isChoreTask и состояние hideChores, фильтр строк и колонок доски/списка, счётчик видимых", "переключатель в подшапке: aria-pressed, число chore, пустое состояние «все задачи chore»", "тест панели: красный на 0.1.40, зелёный на 0.1.41", "README и PROOF; пакет 0.1.41; браузерное доказательство на втором сервере; make verify"]
stepsDone: 4
---

В панели Project state добавить переключатель, который скрывает chore-задачи из вида доски и списка: одна кнопка с aria-pressed в подшапке доски, счётчик показывает число скрытых chore в текущем фильтре, по умолчанию chore видны, state/ и index.json не пишутся. Доказать тестом red→green и браузерным прогоном на втором сервере.
