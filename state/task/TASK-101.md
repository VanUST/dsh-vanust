---
id: TASK-101
kind: task
title: "Дизайн экономии контекста: компакция, длина сессий, проекция run_code"
status: done
revision: 1
createdAt: 2026-11-17T15:52:40.270Z
updatedAt: 2026-11-17T15:52:40.270Z
boardId: task-mwdkg626-yp16ei
---

Спроектировать (не внедряя) оптимальный набор изменений, сокращающих расход на контекст в этом деплое: учесть уже установленные слои сжатия (RTK, headroom, image-window, tool-result-pruner, compaction-basic), измерить фактическую картину по логам сессий и создать документ с эффектами, рисками, точками правки, протоколом проверки и отката.

Migrated from .dsh/taskboard.json (task task-mwdkg626-yp16ei, revision 5).
