---
id: TASK-376
kind: task
title: "Финальная сборка: taskboard 0.1.92, state-feed, tool-families 0.1.15, зелёный verify"
status: done
revision: 9
createdAt: 2026-11-27T17:51:57.936Z
updatedAt: 2026-11-27T18:10:03.968Z
acceptance:
  - text: "Пересобраны и побайтно равны исходникам: `cc-dsh-taskboard-0.1.92.tgz` (с `task_batch`), `cc-dsh-state-feed-*.tgz` (правка шага), `cc-dsh-tool-families-0.1.15.tgz` (ленивый SDK), `cc-dsh-orchestrator-*.tgz` если правились промпты — sha256 каждого процитирован."
    done: false
  - text: "`make verify` зелёный: 20/20, включая `tarball:matches-source` для taskboard и state-feed (сейчас красный именно из-за них). Вывод по строкам процитирован."
    done: false
  - text: "`make test` зелёный; отдельно процитированы наборы taskboard (17/17), tool-families (121/121), state-feed."
    done: false
  - text: "Списки инструментов обновлены и совпадают с кодом: `docs/GUIDE.md`, `plugins/tool-families/README.md`, README плагина taskboard — `task_batch` и `sdk_api` упомянуты там, где перечислены остальные; нигде нет списка без них."
    done: false
  - text: "Профиль в репозитории согласован с новыми сборками: `profile/cordis.patch.yml` содержит `task_batch` (оркестраторская строка, уже добавлено) и `profile/package.json` (или его аналог в ките) ссылается на существующие файлы версий 0.1.92 / 0.1.15 / state-feed."
    done: false
  - text: "Проверка, что установка не сломается: `node scripts/kit-update.mjs --check --json` не падает и показывает drift, а не ошибку чтения из-за удалённого `0.1.14.tgz`; вывод процитирован."
    done: false
  - text: "Ничего не установлено в профиль, сервер не перезапускался."
    done: false
boardId: task-mwza3eiu-8buygh
nonScope: ["Не трогать панель и её проекцию.", "Не устанавливать сборки и не перезапускать сервер.", "Правка `sdk_api` (убрать «покажи всё») — отдельной задачей: здесь код не меняем."]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-280]
resultEvidence: ["make verify → 20/20, exit 0; make test → 84/84 (65 файлов плагинов, 1 кейс приёмки, 18 proof), exit 0.", "Подмножества: taskboard 17/17, tool-families 121/121, state-feed 2/2.", "Сборки: taskboard 0.1.92 86e3ecc9…, state-feed 0.1.9 c0ba26f9…, tool-families 0.1.15 b953e5a4… — побайтно равны исходникам; в taskboard есть task_batch и lib/store.mjs.", "kit-update --check --json → exit 0, drift ровно по трём тарболам, applied:[].", "Документация: GUIDE.md:136-138/:153-156, README taskboard:172/186, README tool-families:107-127; cordis.patch.yml:514 содержит task_batch.", "Живой профиль не тронут, сервер не перезапускался."]
resultSummary: "Собрано одно устанавливаемое состояние и проверено дважды: make verify 20/20, make test 84/84 (taskboard 17/17, tool-families 121/121, state-feed 2/2); сборки 0.1.92 / 0.1.9 / 0.1.15 побайтно равны исходникам; kit-update --check даёт drift ровно по трём файлам; документация и профиль согласованы; в профиль ничего не установлено."
role: BACKEND
scope: [plugins/taskboard/, plugins/state-feed/, plugins/tool-families/, plugins/orchestrator/, profile/, docs/]
sessions:
  - sessionId: 3b105999-b577-4150-a314-0150228fd960
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Собрать всё в одно устанавливаемое состояние: пересобрать taskboard 0.1.92, state-feed и подтвердить tool-families 0.1.15, привести списки инструментов в документации в соответствие с кодом, добиться зелёного `make verify` (20/20) и доказать, что `kit-update --check` не сломается из-за удалённого 0.1.14. Ничего не устанавливать.
