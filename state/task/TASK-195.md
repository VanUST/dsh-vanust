---
id: TASK-195
kind: task
title: "P0.4: ревизия карты дизайна как источник designRef"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.926Z
updatedAt: 2026-11-17T15:52:41.926Z
boardId: task-mwko195o-a1q0nu
ownerRole: BACKEND
---

Закрыть §8.3 обзора харнесса: ревизия карты дизайна, за которой следит запись анализа (`designRef.mapRev`), больше не обновляется, потому что анализ читает `design.excalidraw`, а смонтированный плагин `designmap` пишет `designmap/model.yaml`, `views.yaml` и `manifest.json` без поля `rev`. Нужно: `designmap/manifest.json` получает целочисленный `rev`, который поднимается только при изменении семантического содержимого модели (повторное применение того же — не двигает); анализ читает ревизию из `designmap/manifest.json` и по умолчанию смотрит на него; решение D3 записи анализа — ревизия продолжает нумерацию старой сцены (30 → 31), чтобы существующие записи не стали ложно расходящимися.

Migrated from .dsh/taskboard.json (task task-mwko195o-a1q0nu, revision 8).
