---
id: TASK-510
kind: task
title: "Коммит: профиль и проверка ролей"
status: active
revision: 2
createdAt: 2026-11-28T18:28:07.625Z
updatedAt: 2026-11-28T18:28:07.933Z
boardId: task-mx0qtsbe-20lunp
chore: true
choreReason: "Профиль и проверка ролей изменены после прошлого батча; их надо закоммитить, чтобы один перезапуск применил и профиль, и пакеты."
nonScope: ["Не менять тексты по существу.", "Не трогать посторонние файлы."]
owner:
  kind: agent
  label: DEVOPS
  sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
preset: devops
role: DEVOPS
scope: [scripts/check-role-table.mjs, scripts/test/check-role-table.test.mjs, scripts/tool-surface-proof.mjs, scripts/context-bounds-proof.mjs]
sessions:
  - sessionId: 9975a578-5800-4dd0-98ba-1926a948fb3a
    label: DEVOPS
    role: DEVOPS
    status: active
---

Закоммить последнюю правку перед перезапуском: profile/cordis.patch.yml (шесть обещанных картой глаголов возвращены у четырёх ролей; из строки orchestrator убран mcp__godot__* ради потолка 45), scripts/check-role-table.mjs (сверяет allow-список профиля с картой ролей в обе стороны), scripts/test/check-role-table.test.mjs, scripts/tool-surface-proof.mjs и scripts/context-bounds-proof.mjs (закрепляли старую поверхность корня). Прогони make verify, закоммить, приложи коммит, коды и план kit-update — он должен показать запись профиля и пять пакетов из прошлых батчей. Верни: коммит, план, коды.
