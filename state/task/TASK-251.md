---
id: TASK-251
kind: task
title: "Ручное редактирование REQ, TASK и TEST из панели состояния"
status: done
revision: 3
createdAt: 2026-11-19T14:55:06.548Z
updatedAt: 2026-11-19T15:21:27.907Z
acceptance:
  - text: "в карточке REQ, TASK и TEST есть режим Edit; сохранение идёт командой /state через ядро с expectedRevision и пишет журнал с origin human"
    done: false
  - text: "ручное поле не перезаписывается следующей автоматической записью; панель показывает пометку и умеет вернуть поле источнику"
    done: false
  - text: "отказы revision_conflict, status_invalid, field_not_editable доходят до панели одной строкой с кодом и ничего не пишут"
    done: false
  - text: "make verify зелёный, тесты ядра и команды проходят, негативные контроли падают на коде до правки"
    done: false
  - text: "режим Edit показан в браузере на втором сервере: правка сохраняется, перезагрузка показывает новое значение и пометку"
    done: false
boardId: task-mwno96qc-7r0csd
inline: true
nonScope: ["создание и удаление сущностей из панели: идентификаторы выдаёт ядро, а существование строки принадлежит зеркалу; это отдельная задача", "правка ключей источника (analysisRef, boardId, caseId), ревизии и производных хешей", "ослабление гейтов task_close/complete/evidence: ручная правка не отменяет их проверки", "живой сервер :3080 не перезапускается; UI проверяется на втором сервере"]
reqIds: [REQ-151, REQ-152, REQ-153, REQ-154]
resultArtifacts: [docs/analysis/state-entities-manual-editing.json, plugins/project-state/test/manual-edit.test.mjs, plugins/project-state/test/state-command.test.mjs, plugins/project-state-panel/test/edit-mode.test.mjs]
resultEvidence: ["второй сервер :3081 (копия профиля web, строки на file:///tmp/...): TASK-250 → Edit → новое название → Save → «TASK-250 saved at revision 7; yours now: title», форма сохраняет revision 7, пометка «правит человек»", "там же: «↺ вернуть источнику» → «TASK-250: title returned to the source; revision 9», пометка исчезла; state/task/TASK-250.md: исходное название, revision 9, manualFields отсутствует; state/events.jsonl seq 1057-1059 с origin human", "node --test plugins/project-state/test/manual-edit.test.mjs → 8/8 exit 0; на worktree из git HEAD → 6 из 8 падают", "node --test plugins/project-state/test/state-command.test.mjs → 7/7 exit 0; на коде из git HEAD → 7 из 7 падают", "node --test plugins/project-state-panel/test/edit-mode.test.mjs → 9/9 exit 0; на коде из git HEAD → 8 из 9 падают; counts-and-sort 1/1 зелёный после смены правила о трёх точках вызова команд", "node --test всех тестов project-state и панели → 40/40 exit 0; make verify → exit 0 (18/18, документация, глоссарий, tarball:matches-source)", "тарболы cc-dsh-project-state-0.1.15.tgz (sha256 e423cfdd…) и cc-dsh-project-state-panel-0.1.45.tgz (sha256 b33ee818…) собраны из исходника", "живой :3080 не тронут; второй сервер остановлен, копия профиля web-stateedit, /tmp-копии и тестовая сессия удалены"]
resultSummary: "Владелец может править любое содержательное поле и текст REQ, TASK и TEST из панели состояния: в карточке появилась вкладка Edit со схемой полей вида, запись идёт командой /state через ядро (проверка ревизии, журнал origin human, перегенерация проекций). Правка помечается как «правит человек» (manualFields/manualAt), следующие записи зеркал её не перезатирают и не двигают revision, а «вернуть источнику» снимает пометку. Ключи источника и производные хеши правке не подлежат и названы в форме. Доказательства: живая панель на втором сервере (save на rev 7, release на rev 9), red/green тесты (на коде из git HEAD падают 6/8, 7/7 и 8/9), 40/40 тестов, make verify exit 0, оба тарбола перепакованы."
scope: ["plugins/project-state/lib/core.mjs: origin human, manualFields/manualAt, release, отказ производных полей, source в update", "plugins/project-state/index.mjs: команда /state (edit) в host-строке", "plugins/project-state-panel/client.js: вкладка Edit с контролами по схеме вида и возвратом источнику", "plugins/project-state/README.md и plugins/project-state-panel/README.md", "tests ядра состояния и команды, proof-скрипт", "тарболы cc-dsh-project-state и cc-dsh-project-state-panel"]
steps: ["Ядро: origin human, manualFields/manualAt, release, пропуск ручных полей, отказ производных, source в списке полей", "Команда /state в host-строке project-state: edit/release, отказы с кодом", "Панель: режим Edit для REQ/TASK/TEST, контролы по схеме вида, пометки ручных полей и возврат источнику", "Документация обоих плагинов: кто правит, что происходит с зеркалами", "Тесты ядра и команды плюс proof-скрипт с негативными контролями", "Красный прогон на коде до правки, зелёный после; make verify", "Перепаковка тарболов, проверка Edit в браузере на втором сервере, запись анализа и отчёт"]
stepsDone: 7
---

Владелец должен получить полное ручное редактирование REQ, TASK и TEST из панели состояния: сейчас панель — линза только для чтения, а правка файлов в state/ отклоняется. Нужен режим Edit в карточке сущности, который пишет через ядро состояния (единственный писатель) с проверкой ревизии, журналом и пометкой полей, которые правит человек, чтобы следующие записи зеркал их не затирали. Запись по команде /state, отказы называются кодом и сообщением, проекции перегенерируются.
