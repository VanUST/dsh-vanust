---
id: TASK-267
kind: task
title: "Кейсы таскборда: негативный контроль через CASE_NEGATIVE_CONTROL"
status: done
revision: 5
createdAt: 2026-11-20T12:24:38.409Z
updatedAt: 2026-11-23T08:45:00.542Z
boardId: task-mwoybhye-voa1qg
nonScope: ["Не менять поведение плагина и формат доски", "Не трогать ~/.npm/dsh и :3080", "Не менять другие тесты и кейсы"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-173, REQ-174]
role: BACKEND
scope: ["plugins/taskboard/test/board-lock.test.mjs, plugins/taskboard/test/dead-child-close.test.mjs", "docs/cases/task-closes-*.json, docs/cases/two-processes-*.json (negativeControl, runCommand)", "docs/cases/runs/ — артефакты прогонов"]
---

Свести два кейса таскборда к стандартному негативному контролю, чтобы они могли стать verified и задача закрылась. Сделать: тесты board-lock.test.mjs и dead-child-close.test.mjs при CASE_NEGATIVE_CONTROL=expect-pre-fix загружают модуль из .dsh/red-first/taskboard.mjs (копия git HEAD, она уже есть) вместо текущего и падают ровно теми assertion'ами, что описывают дефект; без переменной — грузят текущий модуль и проходят. В кейсах выставить negativeControl: expect-pre-fix и убедиться, что surfaceFiles и runCommand указывают на эти тесты и `node --test <файл>`. Прогнать: `node --test` обоих файлов без контроля — зелёные; `CASE_NEGATIVE_CONTROL=expect-pre-fix node --test` каждого — красные; затем `case_run` mode red (control expect-pre-fix) и mode green для обоих кейсов, чтобы оба стали verified; затем `make test` — 70/70 exit 0 (плюс два новых шага, если test-all их подхватит).
