---
id: TASK-458
kind: task
title: "Разобрать красный delegation-basis-proof и получить зелёный make test"
status: done
revision: 4
createdAt: 2026-11-28T13:57:25.568Z
updatedAt: 2026-11-28T14:00:51.647Z
boardId: task-mx0h5o2d-21c1bl
chore: true
choreReason: "Полный make test красный на delegation-basis-proof; до разбора гейт не даёт зелёного прогона."
nonScope: ["Плагины, профиль, развёртывание; только разбор и, если нужно, правка самого proof-скрипта под реальное поведение."]
owner:
  kind: agent
  label: BACKEND
  sessionId: bbf8a2f9-cb8d-4d64-82c6-867feafd3695
preset: backend
resultEvidence: ["Воспроизведение: node scripts/delegation-basis-proof.mjs --dir .tmp/delegation-basis/run1 → FAIL {rows:3}; рядом с board-3.json лежат общие taskboard.events.ndjson и taskboard.snapshot.json — третий harness унаследовал строки первого.", "Причина в продукте, не дефект: pathsFor кладёт журнал и снапшот в dirname(boardPath) под фиксированными именами (plugins/taskboard/lib/store.mjs:42–47); путь захвата корректен (orchestrator.mjs:1129–1172 вызывает taskboard.update, не create).", "Правка scripts/delegation-basis-proof.mjs: у каждого harness своя рабочая папка workspace-N; проверка усилена — одна строка и её id равен захватываемой.", "Зелёный: 13/13 checks passed, exit 0, {rows:1, ids:[...]}.", "Негативный контроль на подложенном дефекте: 11/13, exit 1, красные ровно две строки захвата, {rows:2}.", "Полный make test: 89/89 passed in 69944 ms, exit 0."]
resultSummary: "Красный delegation-basis-proof разобран: это не регрессия захвата задачи, а проверка, зависимая от общего каталога — доски в одной папке делят журнал taskboard.events.ndjson и наследуют строки. Стенд изолирован по папкам, проверка усилена сверкой id, полный make test зелёный (89/89)."
role: BACKEND
scope: [.tmp/delegation-basis/, scripts/delegation-basis-proof.mjs]
sessions:
  - sessionId: bbf8a2f9-cb8d-4d64-82c6-867feafd3695
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Разбери красный scripts/delegation-basis-proof.mjs («the attach created no second row {rows:3}») и доведи полный make test до зелёного. Сделай: (1) воспроизведи падение на чистой одноразовой доске и покажи, какое состояние даёт rows:3 вместо ожидаемых двух; (2) определи, это регрессия пути attach (вторая строка действительно создаётся) или проверка, зависящая от чужого состояния доски; (3) если регрессия — назови точное место в плагине и предложи правку, не делая её в этом заходе; если проверка хрупкая — исправь её так, чтобы она проверяла именно захват задачи, и докажи, что она по-прежнему падает на подложенном дефекте (негативный контроль) и проходит на законном пути; (4) приложи прогон полного make test с кодом возврата.
