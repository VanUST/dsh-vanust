---
id: TASK-470
kind: task
title: "Объявить снятие связи потребителям и закоммитить батч"
status: done
revision: 5
createdAt: 2026-11-28T14:56:18.991Z
updatedAt: 2026-11-28T15:59:53.745Z
boardId: task-mx0j9efz-04n3ti
chore: true
choreReason: "Снятие связи работает в ядре, но не объявлено в host-строке и README — операцию не видят панель и другие плагины."
nonScope: ["Не менять поведение ядра и других операций; не трогать развёртывание."]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["plugins/project-state/index.mjs: unlink делегируется в сервис ccProjectState рядом с link; README описывает операцию строкой с link_missing.", "Проба через apply(ctx): сервис публикуется как ccProjectState, typeof service.unlink === function, цепочка link → unlink → link → replay проходит, повторное снятие отвергается link_missing, exit 0.", "Тесты состояния 43/43, exit 0.", "Коммит 2598dca: 21 файл — ядро, тесты, виды, DEC-004, план, host-строка, README, кейс и журнал кейсов."]
resultSummary: "unlink объявлен в host-строке сервиса и README, доступен потребителям через ccProjectState (проба link → unlink → link → replay проходит), поведение ядра не менялось, тесты 43/43; батч закоммичен (2598dca). Пакет требует пересборки."
role: BACKEND
scope: [plugins/project-state/index.mjs, plugins/project-state/README.md, state/]
---

Объяви снятие связи там, где его ищут потребители, и закоммить батч. Сделай: (1) добавь unlink в список делегируемых методов host-строки plugins/project-state/index.mjs, чтобы панель и другие плагины видели операцию; (2) опиши её в README плагина одной строкой рядом с link; (3) проверь, что сервис через ctx отдаёт unlink и что существующие тесты проходят; (4) git add ядра, теста, решения DEC-004, видов, host-строки и README, коммит с описанием; (5) прогони make verify и приложи код возврата. Сервер не перезапускай.
