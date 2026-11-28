---
id: TASK-505
kind: task
title: "Роль ARCHITECT: право записать решение и файл"
status: done
revision: 5
createdAt: 2026-11-28T18:10:12.023Z
updatedAt: 2026-11-28T18:13:58.129Z
boardId: task-mx0q6pza-4jeeqq
chore: true
choreReason: "Роль ARCHITECT не может записать своё решение в запись анализа: в её пресете нет инструментов записи, поэтому консультацию пришлось вносить оркестратору."
nonScope: ["Не менять политику и код плагинов.", "Не трогать персоны других ролей."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["profile/cordis.patch.yml: preset-architect tool-fs write/edit false → true; families.architect.allow + analysis_upsert, edit, write (19 инструментов).", "check-preset-configs exit 0 (147 строк, 1 unverifiable, 0 refused); schema-lint exit 0 (0 red); check-boundaries --check exit 0; --dump-config подтверждает строки профиля.", "Персона ARCHITECT переписана: она владеет docs/ARCHITECTURE.md и правит его сама, а запись в Analysis Record делает оркестратор дословно из её ответа — состояние пишет один, как требует инвариант.", "Намеренно не добавлены: bash/pwsh, tool-jobs, инструменты доски, case_*, MCP."]
resultSummary: "Роль ARCHITECT получила право писать в файл архитектуры (write/edit) и разрешение на analysis_upsert в профиле; персона переписана так, что файл правит она, а запись решения в Analysis Record делает оркестратор дословно — состояние остаётся с одним писателем."
role: DEVOPS
scope: [profile/cordis.patch.yml]
---

Дай роли ARCHITECT возможность записывать своё решение. Сейчас в её пресете нет ни analysis_upsert, ни tools записи, поэтому архитектор формулирует решение и не может его внести — это делает оркестратор, то есть консультация идёт через чужого посредника, и «архитектор правит архитектуру» остаётся словами. Сделай: (1) добавь роли ARCHITECT инструменты записи, минимально необходимые: analysis_upsert и запись файла (write/edit), чтобы она могла править docs/ARCHITECTURE.md и запись анализа; (2) не давай ей инструментов исполнения команд, доски и делегирования; (3) прогони проверку пресетов и схем, приложи коды и итоговый список инструментов роли. Верни: что добавлено, что намеренно нет, коды.
