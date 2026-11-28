---
id: TASK-510
kind: task
title: "Коммит: профиль и проверка ролей"
status: done
revision: 5
createdAt: 2026-11-28T18:28:07.625Z
updatedAt: 2026-11-28T18:39:51.247Z
boardId: task-mx0qtsbe-20lunp
chore: true
choreReason: "Профиль и проверка ролей изменены после прошлого батча; их надо закоммитить, чтобы один перезапуск применил и профиль, и пакеты."
nonScope: ["Не менять тексты по существу.", "Не трогать посторонние файлы."]
owner:
  kind: agent
  label: DEVOPS
preset: devops
resultEvidence: ["Коммит 87e304a: 21 файл, +382/−101 — профиль (шесть глаголов у четырёх ролей, mcp__godot__* снят из allow оркестратора и остался в projectDeny), check-role-table в обе стороны, его тест, два пруфа, кейс доставки архитектуры.", "check-role-table exit 0 (role table ok, включая «profile row backend — 7 case verb(s) agree»); тест 3 pass, 0 fail, exit 0.", "make verify exit 0 до и после коммита.", "kit-update план: write-profile-files cordis.patch.yml, write-rules DEPLOYMENT.md, пять пакетов — orchestrator 0.1.87, project-state 0.1.25, project-state-panel 0.1.53, state-feed 0.1.12, taskboard 0.1.99."]
resultSummary: "Последняя правка закоммичена (87e304a): профиль приведён к карте ролей, проверка ролей сверяет профиль в обе стороны, verify зелёный; план обновления содержит запись профиля, правил и пять пакетов — всё уедет одним перезапуском."
role: DEVOPS
scope: [scripts/check-role-table.mjs, scripts/test/check-role-table.test.mjs, scripts/tool-surface-proof.mjs, scripts/context-bounds-proof.mjs]
---

Закоммить последнюю правку перед перезапуском: profile/cordis.patch.yml (шесть обещанных картой глаголов возвращены у четырёх ролей; из строки orchestrator убран mcp__godot__* ради потолка 45), scripts/check-role-table.mjs (сверяет allow-список профиля с картой ролей в обе стороны), scripts/test/check-role-table.test.mjs, scripts/tool-surface-proof.mjs и scripts/context-bounds-proof.mjs (закрепляли старую поверхность корня). Прогони make verify, закоммить, приложи коммит, коды и план kit-update — он должен показать запись профиля и пять пакетов из прошлых батчей. Верни: коммит, план, коды.
