---
id: TASK-442
kind: task
title: "Проверка: документов ровно три и без состояния"
status: done
revision: 9
createdAt: 2026-11-28T13:14:11.805Z
updatedAt: 2026-11-28T13:37:40.600Z
boardId: task-mx0fm2hf-x9jmfc
nonScope: ["docs/, README.md, plugins/ — содержание правит другой исполнитель; установка и развёртывание."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-297]
resultEvidence: ["check-documentation.mjs: правила undeclared_document, state_version, state_task_id, state_counter, document_date_missing, document_stale; режим --documents-only для фикстур.", "scripts/check-documentation.test.mjs: 9/9 зелёные; красный на неправильной реализации — 8 из 9 падают, exit 1.", "Пин вида @deepseek-ai/dsh@<pin> исключён из правила версий: его требует отдельная проверка.", "Из проверки и фикстуры убраны упоминания удалённого PRESET-PLAYBOOKS.md; разрешённых путей стало меньше."]
resultSummary: "Правило трёх документов закреплено проверкой с девятью фикстурными тестами: документ вне списка, версия, номер задачи, счётчик, отсутствие и старость даты — отказ с названным кодом; живой прогон зелёный."
role: BACKEND
scope: [scripts/check-documentation.mjs, scripts/check-documentation.test.mjs]
sessions:
  - sessionId: ebb39f39-079c-4e0b-a88f-0bbfb4ad4832
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Закрепи правило «три документа» проверкой, иначе оно проживёт неделю. Расширь scripts/check-documentation.mjs так, чтобы он отказывал: (1) любому markdown-файлу в docs/ вне списка GUIDE, ARCHITECTURE, TERMINOLOGY (PRESET-PLAYBOOKS и каталоги cases/analysis — исключения, названные явно); (2) документу, в тексте которого есть версия вида N.N.N, номер задачи (TASK-..., task-mx...) или счётчик вида «N из M» — это состояние, у него есть владелец; (3) документу без даты проверки или с датой старше связанных файлов, на которые он ссылается. Каждое правило — с тестом на фикстуре: документ вне списка, документ с версией, документ с номером задачи, документ без даты — каждый должен упасть, а законный набор — пройти.
