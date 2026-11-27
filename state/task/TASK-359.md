---
id: TASK-359
kind: task
title: "Чистка spill в autolabel_pipeline и dsh-kit"
status: done
revision: 5
createdAt: 2026-11-27T16:02:45.786Z
updatedAt: 2026-11-27T16:05:20.457Z
boardId: task-mwz66yir-vdz1p3
chore: true
choreReason: "По прямой просьбе владельца: почистить каталоги spill с сохранёнными выводами инструментов, они не нужны после завершения хода."
nonScope: ["Не удалять логи сессий и состояние проектов.", "Не запускать и не останавливать серверы.", "Не менять код и настройки."]
owner:
  kind: agent
  label: BACKEND
  sessionId: b8df7558-3a7c-486f-8aa5-e6681c9b0f05
preset: backend
resultEvidence: ["Удаление: `find \"$sp\" -type f -mmin +1440 -print0 > list-<проект>.bin` + `xargs -0 -r rm -f`, rm_exit=0 на оба каталога.", "autolabel_pipeline: 7711 файлов / 131 943 973 Б → 1680 / 29 652 772 Б (удалено 6031 файл / 102 291 201 Б). dsh-kit: 551 / 13 906 819 Б → 120 / 3 817 121 Б (удалено 431 / 10 089 698 Б). Итого 112 380 899 Б (≈107 МиБ).", "Держатели: `ls -l /proc/*/fd/* | grep -cF '/.dsh/spill'` → 0 до удаления и 0 перед rm.", "Списки удалённого: 6031 и 431 запись, вне `/.dsh/spill/` — 0 в обоих.", "Рабочие деревья не изменились: dsh-kit state 1024 файла c3e02650…, docs 682 dca02fa2…, .dsh без spill 244 2860529f…; autolabel .dsh без spill 14 fee23680…, git HEAD 3e2bc6b3; taskboard.json 13 293 236 Б и journal 217 894 Б на месте.", "older24h_left=0 в обоих каталогах; свежие файлы целы (новейшие 18:52 и 18:56)."]
resultSummary: "Каталоги spill почищены: освобождено ≈107 МиБ (112 380 899 Б). autolabel_pipeline 7711→1680 файлов (131.9→29.7 МБ), dsh-kit 551→120 (13.9→3.8 МБ). Удалялись только файлы старше 24 часов, только внутри .dsh/spill; держателей не было (скан /proc/*/fd = 0), списки удалённого не содержат путей вне spill, хеши state/, docs/ и не-spill части .dsh совпадают до и после, доска задач и журнал на месте."
role: BACKEND
scope: [/tmp/spill-clean/]
sessions:
  - sessionId: b8df7558-3a7c-486f-8aa5-e6681c9b0f05
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Почистить каталоги spill в autolabel_pipeline (144 МБ / 7711 файлов) и dsh-kit (15 МБ): удалить только файлы старше суток, оставив свежие, и доказать числами до/после, что состояние и журналы проектов не пострадали.
