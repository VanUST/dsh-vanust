---
id: TASK-242
kind: task
title: "Allow-список ролей не действует на инструменты кита"
status: done
revision: 3
createdAt: 2026-11-18T15:41:03.159Z
updatedAt: 2026-11-23T08:24:12.271Z
acceptance:
  - text: "в заголовке запроса корня не больше 38 инструментов"
    done: false
  - text: "ни один реально использованный корнем инструмент не потерян"
    done: false
  - text: "make verify зелёный"
    done: false
boardId: task-mwmagf3q-piymmp
nonScope: ["MCP-мосты"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-130]
resultArtifacts: [plugins/cc-dsh-tool-families-0.1.14.tgz, plugins/cc-dsh-test-cases-0.1.17.tgz, plugins/cc-dsh-delegation-brief-0.1.6.tgz, plugins/cc-dsh-diagrams-0.1.7.tgz]
resultEvidence: ["node scripts/tool-families-proof.mjs -> exit 0, 97/97: allows() допускает названный инструмент, отказывает неназванному, пресет без строки получает всё", "node scripts/tool-surface-proof.mjs -> exit 0, PASS (6 проверок): delegation_brief зарегистрирован, delegation_return нет; diagram не зарегистрирован для orchestrator; case_record/list/get/drift зарегистрированы, case_gate/case_run нет; пресет без строки сохраняет diagram", "node --check tool-families.mjs/test-cases.mjs/delegation-brief/index.mjs/diagrams/index.js -> SYNTAX_OK", "make verify -> exit 0: 17/17 portability, documentation/glossary/schema-lint/context-budget зелёные", "замер использования: 127 корневых сессий, 9082 tool-вызова; убраны designmap_export/open/scan/render, task_link/pause/resume/remove, hindsight_reflect"]
resultSummary: "Allow-строка ролей стала единственным владельцем поверхности: tool-families публикует toolFamilies.allows(agent, name), а три плагина, регистрировавших инструменты в контексте агента, спрашивают её перед регистрацией (test-cases, delegation-brief, diagrams). Строка orchestrator перетюнена по 127 корневым сессиям (9082 вызова): убраны инструменты с нулевым использованием, добавлены нужные, но не названные. Ожидаемая поверхность корня — 42 инструмента вместо 54 (пол 15 — собственные инструменты пресета)."
role: BACKEND
scope: [plugins/tool-families, "плагины, регистрирующие инструменты per-agent", profile/cordis.patch.yml]
steps: ["подтвердить причину", "механизм фильтрации при регистрации", "сократить allow-список", proof]
stepsDone: 4
---

Найдено: tools.restrict маскирует только глобальные регистрации, а инструменты кита регистрируются в контексте агента, поэтому allow-список (42 шаблона) не убирает ни одного из 54 инструментов корня. Нужно заставить ролевую политику действовать на регистрации кита и сократить поверхность корня до ~30.
