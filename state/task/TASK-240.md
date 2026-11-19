---
id: TASK-240
kind: task
title: "Ограничить контекст на входе: проекция выдачи и task_list"
status: review
revision: 2
createdAt: 2026-11-18T15:41:01.409Z
updatedAt: 2026-11-18T15:47:00.393Z
acceptance:
  - text: "read выше 8 KiB приходит баннером с путём и полный текст читается по этому пути"
    done: false
  - text: "task_list(scope:workspace) без limit отдаёт сводку и не более 25 задач"
    done: false
  - text: "task_get/task_update/analysis_*/skill не обрезаются"
    done: false
  - text: "промпт оркестратора не требует полной доски на старте"
    done: false
boardId: task-mwmagdss-6qwtzl
nonScope: ["живой сервер :3080", "чужие незакоммиченные правки в дереве"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-128, REQ-129, REQ-134]
resultArtifacts: [plugins/cc-dsh-run-code-projection-0.1.2.tgz, plugins/cc-dsh-orchestrator-0.1.60.tgz]
resultEvidence: ["node plugins/run-code-projection/proof/proof.mjs -> exit 0, PASS (18 checks): read 12 000 символов -> баннер + spill читается, task_get 12 000 символов не тронут, bash спроецирован, старый баннер не перепроецируется", "node plugins/taskboard/proof/task-list-paging.mjs -> exit 0, PASS (12 checks): workspace-страница 25 из 60, counts по статусам, next-курсор, 6 303 символа вместо 61 884", "node --check plugins/taskboard/taskboard.mjs && node --check plugins/orchestrator/orchestrator.mjs -> SYNTAX_OK", "make verify -> exit 0 (17/17 portability and packaging)"]
resultSummary: "Проекция выдачи расширена с run_code до набора инструментов (read, bash/pwsh, web_fetch, страницы Hindsight, grep/glob/outline, task_list); task_list отдаёт counts + страницу с next-курсором; промпт оркестратора требует читать workspace-историю страницами. Полный текст пишется в .dsh/spill и читается обратно; task_get/analysis_*/skill/делегирование не обрезаются."
role: BACKEND
scope: [plugins/run-code-projection, plugins/taskboard, plugins/orchestrator, profile/cordis.patch.yml, plugins/inventory.json, docs]
steps: ["проекция выдачи в plugins/run-code-projection", "task_list со сводкой и страницами", "стартовый сценарий в промпте оркестратора", "proof + гейты"]
stepsDone: 4
---

Крупная выдача инструмента перестаёт занимать весь контекст: проекция на tools/post-execute (баннер + голова + хвост + путь к полному тексту) для read/bash/web_fetch/hindsight_*/task_list, страничный task_list и стартовый сценарий оркестратора без полной доски.
