---
id: TASK-272
kind: task
title: "Коммит и push правки библиотеки кейсов"
status: active
revision: 2
createdAt: 2026-11-20T15:02:19.014Z
updatedAt: 2026-11-20T15:02:20.048Z
boardId: task-mwp3y9u9-luv90r
chore: true
choreReason: "Публикация готовой правки библиотеки кейсов: коммит и push в origin/main, без изменения кода."
nonScope: ["Не менять код, конфигурацию и кейсы — только git add/commit/push", "Не переписывать историю (--amend/--force/rebase) и не трогать другие ветки", "Не коммитить игнорируемое (.dsh/, .cache/, docs/cases/runs/)"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 13d7e613-7524-4d67-98a4-6063d061fc6f
preset: backend
role: BACKEND
scope: ["git add/commit/push, ветка main"]
sessions:
  - sessionId: 13d7e613-7524-4d67-98a4-6063d061fc6f
    label: BACKEND
    role: BACKEND
    status: active
---

Закоммитить и запушить правку библиотеки кейсов. (1) `git status --porcelain` — снять картину, проверить, что .dsh/, .cache/ и docs/cases/runs/ не попадают в индекс. (2) `git log --oneline -5` — следовать стилю. (3) Добавить всё неигнорируемое и напечатать число путей. (4) Один коммит с сообщением, объясняющим суть: роли получают case_update и case_verify по своим обязанностям, запись прогона хранит каталог запуска, прибитая к одному дереву команда отклоняется, README-таблица и подсказка роли сверяются тестом; в теле назвать доказательства (34/34 тестов плагина, 72/72 make test, три кейса verified red→green). (5) Push по процедуре навыка с retry; сверить ls-remote refs/heads/main с локальным HEAD. (6) Финальный `git status --porcelain` — что осталось и почему.
