---
id: TASK-213
kind: task
title: "V1.7: state-feed — L1 первым сообщением и L2-дельты по хешу (FR4)"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.380Z
updatedAt: 2026-11-17T15:52:42.380Z
acceptance:
  - text: "Новый хост-плагин `@cc/dsh-state-feed` с сервисом/гаком; на корневой сессии один раз даёт L1 — одно user-сообщение с digest.md, планом и последним snapshot.md (плюс короткий заголовок), и больше его не трогает"
    done: false
  - text: "Нет `state/` в воркспейсе — нет инъекции (no-op, без ошибки); воркерская сессия сводки не получает"
    done: false
  - text: "L2: на границе хода считается хеш содержимого (digest+board+snapshot); при смене — одна агрегированная дельта ≤300 токенов, при неизменности — ничего; несколько изменений за ход дают одну дельту"
    done: false
  - text: "Инъекции идут через `agent.inject()` и видны в журнале как `user/message` (model-visible means logged); L1 не повторяется на следующих ходах"
    done: false
  - text: "Доказательство: unit-тесты с подставным контекстом (L1 один раз, no-op без state, L2 по хешу, агрегация, воркер без сводки) + живая сессия на тестовом порту, где первое user-сообщение содержит digest; `make verify` exit 0"
    done: false
boardId: task-mwktlmsi-4xniyu
nonScope: ["менять ядро состояния и формат проекций — только читать их", "реестр REQ и модельные тулзы — отдельно", "миграции, гейты lifecycle, политика записи — отдельно", "живой :3080; доказательство на копии рабочего профиля на другом порту"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["node --test plugins/state-feed/test/*.test.mjs → tests 6 / pass 6 / fail 0, exit 0", "make verify → exit 0 (17/17 + documentation ok)", "живая сессия 5bf2b43d (копия в reports/probes/v17/): state-feed seq 12 до человеческого seq 13; L2 seq 37 — проверено мной декодированием журнала", "инъекции видны как user/message с source.kind state-feed — model-visible means logged"]
resultSummary: "state-feed поставлен и доказан: L1 — одно user-сообщение (digest → план → снимок), в живой сессии это первое сообщение (seq 12) раньше человеческого (seq 13), повторно не инжектится; L2 — одна агрегированная дельта (341 Б при лимите 1200 Б) только при смене sha256 содержимого, второе изменение в том же ходу не инжектится; воркер и воркспейс без state/ получают ничего (no-op). Все инъекции идут через agent.inject и видны в журнале как user/message с source.kind state-feed. Тесты 6/6, make verify зелёный, тарбол state-feed 0.1.1."
role: BACKEND
scope: ["новый плагин plugins/state-feed/ (index.mjs, lib/, test/, README.md, package.json)", "учёт плагина: inventory.json, README/USERGUIDE, профиль — строка хоста", "доказательство на копии рабочего профиля: второй порт, один корневой сеанс, журнал"]
---

Реализовать доставку состояния (FR4): новый хост-плагин `@cc/dsh-state-feed`, который на корневой сессии один раз даёт L1 — первое user-сообщение с сгенерированным digest, планом и последним снимком — и на границе каждого хода даёт L2-дельту, только если изменился хеш содержимого, агрегированную по ходу и ≤~300 токенов. Воркер сводки не получает; нет `state/` — нет инъекции. Все инъекции через `agent.inject()` и поэтому попадают в журнал как `user/message` — правило «model-visible means logged» выполняется без отдельного механизма. L1 не редактируется задним числом: одно сообщение, один раз. Докажи подставным контекстом (L1 один раз, no-op, L2 по хешу, агрегация) и одной живой сессией на тестовом порту с digest в первом сообщении.

Migrated from .dsh/taskboard.json (task task-mwktlmsi-4xniyu, revision 7).
