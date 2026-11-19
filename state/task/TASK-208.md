---
id: TASK-208
kind: task
title: "V1.4: ядро состояния — ccProjectState, схема, журнал, CAS, verify"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.248Z
updatedAt: 2026-11-17T15:52:42.248Z
acceptance:
  - text: "Сервис `ccProjectState` отдаётся через `ctx.provide` + `ctx.effect`, один `inject` на `tools` не нужен; вызовы не бросают в чужие ходы — ошибки возвращаются кодом"
    done: false
  - text: "Сущности REQ/DECISION/TASK/TEST пишутся файлом на сущность с YAML frontmatter и телом; формат детерминирован (повторная запись тех же данных даёт те же байты)"
    done: false
  - text: "ID выдаёт ядро под локом: параллельные создания не дают коллизий (тест Promise.all на 20 созданиях)"
    done: false
  - text: "Связь хранит хеш содержимого цели на момент валидации; правка цели делает связь stale в verify()"
    done: false
  - text: "CAS: update/complete со старым revision отказывают с кодом и не пишут файл"
    done: false
  - text: "Журнал append-only JSONL: реплей даёт те же байты состояния (сравнение хешей всех файлов до/после)"
    done: false
  - text: "verify() возвращает структурированные находки: сирота, битая ссылка, REQ без критериев, TASK без REQ (если не chore+причина), stale-хеш, битый frontmatter; ничего не переписывает"
    done: false
  - text: "Тесты `node --test plugins/project-state/test/*.test.mjs` зелёные; `make verify` exit 0 включая inventory:matches-disk, README/USERGUIDE называют новый плагин; тарбол совпадает с исходником"
    done: false
boardId: task-mwksiniq-ss2azr
nonScope: ["модельные тулзы (REQ/TASK-операции) — потребители, следующая задача", "проекции views/ и их детерминизм — FR7 отдельно; только не мешать им", "миграции docs/analysis и .dsh/taskboard.json — FR13", "гейты lifecycle и политика записи — FR8", "живой :3080; доказательство тестами и прогоном на временном воркспейсе"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["node --test plugins/project-state/test/*.test.mjs → tests 8 / pass 8 / fail 0, exit 0 (моя проверка)", "make verify → exit 0 (17/17 + documentation ok, 24 плагина)", "service провайдится: plugins/project-state/index.mjs:72 ctx.provide('ccProjectState', service) + ctx.effect", "20 параллельных create → 20 разных ID (state/.lock); CAS revision_conflict не пишет файл; replay ловит ручную правку как bytes_differ; verify() отдаёт link_stale/link_broken/req_criteria_missing/task_req_missing/orphan/frontmatter_invalid", "тарбол cc-dsh-project-state-0.1.1.tgz: lib/core.mjs sha совпадает с исходником"]
resultSummary: "Ядро состояния поставлено: плагин @cc/dsh-project-state с сервисом ccProjectState — единственный писатель state/. Схема REQ/DECISION/TASK/TEST (markdown + YAML frontmatter), детерминированный writer, ID под директорным локом (20 параллельных create → 20 ID), связи с sha256 цели (правка цели → link_stale), CAS (revision_conflict не пишет), append-only журнал с replay (ловит ручную правку как bytes_differ), snapshot/verify только читают. verify() отдаёт 9 классов находок и ничего не переписывает. Тесты 8/8, make verify зелёный, тарбол 0.1.1 совпадает с исходником. Проекции, модельные тулзы, миграции и политика записи — следующие задачи."
role: BACKEND
scope: ["новый плагин plugins/project-state/ (index.mjs, lib/, test/, README.md, package.json) — сервис, схема, журнал, CAS, verify", "plugins/inventory.json, README.md, USERGUIDE.md — учёт нового плагина", "profile/cordis.patch.yml — строка хоста для сервиса (без тулзов)"]
---

Построить ядро экосистемы состояния — тонкий хост-плагин `@cc/dsh-project-state` с сервисом `ccProjectState`, единственным писателем каталога `state/` в воркспейсе проекта. Ядро владеет: схемой сущностей (REQ/DECISION/TASK/TEST по §3), типизированными последовательными ID под локом, связями с хешем содержимого цели, CAS для переходов TASK, append-only журналом с реплеем, `verify()` и выдачей ID. Оно НЕ владеет: модельными тулзами, проекциями и миграциями — это следующие задачи. Правила: файл на сущность, markdown + YAML frontmatter + тело, git-friendly; человек правит через git, и его невалидная правка — блокирующая находка verify(), а не молчаливая перезапись; прямая запись агента в state/ режется позже политикой, ядро лишь не оставляет другого пути. Докажи тестами на временном воркспейсе: ID под конкуренцией, хеши связей, CAS, реплей журнала, находки verify().

Migrated from .dsh/taskboard.json (task task-mwksiniq-ss2azr, revision 7).
