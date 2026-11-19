---
id: TASK-195
kind: task
title: "P0.4: ревизия карты дизайна как источник designRef"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.926Z
updatedAt: 2026-11-17T15:52:41.926Z
acceptance:
  - text: "`designmap_apply` с изменением модели поднимает `rev` в `designmap/manifest.json`; повторное применение того же содержимого ревизию не двигает (файл байт-идентичен)"
    done: false
  - text: "Ревизия продолжает старую нумерацию: первый переход даёт 31, поэтому существующие записи с `mapRev: 30` не становятся расходящимися"
    done: false
  - text: "`analysis_check` для записи со старой ревизией сообщает расхождение карты после правки модели; на неизменённой карте расхождения нет"
    done: false
  - text: "Тесты designmap и analysis зелёные; `make verify` exit 0; тарболы перепакованы и совпадают с исходниками"
    done: false
boardId: task-mwko195o-a1q0nu
nonScope: ["§8.2/§8.4 (P0.3), §8.5 (P0.2), §8.6 (P0.1), §8.7 (P0.5) — отдельные задачи", "экосистема состояния v1 — не начинать", "живой сервер :3080 не трогать", "не менять docs/analysis/*.json — записи анализа принадлежат оркестратору"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["cd plugins/designmap && node --test test/*.test.mjs → ℹ tests 132 / pass 132 / fail 0, exit 0", "node scripts/analysis-before-decomposition-proof.mjs → 138/138, exit 0; на байтах analysis 0.1.9 → 135/138, exit 1; со старым производителем designmap 0.1.17 → 136/138, exit 1", "manifest.mjs: rev = nextRevision(previous, modelContentHash); seed из design.excalidraw только когда rev нет; buildManifest пишет rev + modelHash", "store.mjs:1228 — default designmap/manifest.json, читает document.rev; расхождение = design.rev > mapRev, поэтому записи с 30 не дрейфуют", "make verify → exit 0; тарболы designmap 0.1.19 sha256 8a85d621…, analysis 0.1.10 sha256 8d983366…"]
resultSummary: "§8.3 закрыт. `designmap/manifest.json` получает `rev` (монотонный счётчик семантического содержимого модели: хеш канонической модели, +1 только при изменении) и `modelHash`; повторное применение, правка views/overlay ревизию не двигают, no-op apply оставляет файл байт-идентичным. Ревизия продолжает нумерацию старой сцены: manifest без `rev` засевается из `design.excalidraw` (30), первая смысловая правка даёт 31. `analysis` по умолчанию читает `designmap/manifest.json`, legacy-форма сцены ещё понимается; профиль перенацелен. Правило расхождения — `design.rev > mapRev`, поэтому десять существующих записей с `mapRev: 30` не становятся ложными расхождениями; реальная цепочка «apply → rev 31 → analysis_check design_drift» доказана на временном репозитории. Тарболы: designmap 0.1.19 sha256 8a85d621…, analysis 0.1.10 sha256 8d983366…. Не проверено: первый реальный apply на карте самого кита (изменил бы рабочий `designmap/model.yaml`) — по коду он запишет 30 или 31."
role: BACKEND
scope: ["plugins/designmap/src/manifest.mjs (и место, где он вызывается) — rev и хеш содержимого", "plugins/designmap/test — тест на монотонность и идемпотентность", "plugins/analysis/store.mjs — чтение ревизии из designmap/manifest.json и значение по умолчанию", "profile/cordis.patch.yml — designMapFile для analysis", "перепаковка designmap и analysis, документы, на которые падает check-documentation"]
---

Закрыть §8.3 обзора харнесса: ревизия карты дизайна, за которой следит запись анализа (`designRef.mapRev`), больше не обновляется, потому что анализ читает `design.excalidraw`, а смонтированный плагин `designmap` пишет `designmap/model.yaml`, `views.yaml` и `manifest.json` без поля `rev`. Нужно: `designmap/manifest.json` получает целочисленный `rev`, который поднимается только при изменении семантического содержимого модели (повторное применение того же — не двигает); анализ читает ревизию из `designmap/manifest.json` и по умолчанию смотрит на него; решение D3 записи анализа — ревизия продолжает нумерацию старой сцены (30 → 31), чтобы существующие записи не стали ложно расходящимися.

Migrated from .dsh/taskboard.json (task task-mwko195o-a1q0nu, revision 8).
