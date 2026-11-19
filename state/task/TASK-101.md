---
id: TASK-101
kind: task
title: "Дизайн экономии контекста: компакция, длина сессий, проекция run_code"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.270Z
updatedAt: 2026-11-17T15:52:40.270Z
acceptance:
  - text: "каждое предлагаемое изменение имеет эффект, оценённый по измеренным данным, а не по интуиции"
    done: false
  - text: "учтены существующие слои: RTK, headroom, image-window, tool-result-pruner, compaction-basic"
    done: false
  - text: "указаны точные точки правки, протокол проверки и критерии отката"
    done: false
  - text: "открытые вопросы к человеку выделены"
    done: false
boardId: task-mwdkg626-yp16ei
inline: true
nonScope: ["не менять cordis.patch.yml и плагины — только дизайн", "не трогать plugins/orchestrator/* (там незакоммиченные правки не мои)", "не менять ключи/аккаунт на платформе"]
resultEvidence: ["docs/CONTEXT-ECONOMY-DESIGN.md — дизайн на 264 строки: замеры, 3 изменения, протокол проверки, откат", "docs/context-economy.svg.html — диаграмма слоёв (12 узлов, 9 связей, ошибок нет)", "dsh-compaction-basic/lib/index.js:130-132 — formula threshold = min(W×ratio, W−maxTokens−headroom), пакет 0.2.1-rc.2 сверен с registry.npmjs.org", "Логи сессий: 183 сессии, 40 880 шагов, $89.9; 4 сессии ≥2000 шагов = 26%; 25.6% шагов >500K = 40% счёта", "RTK: 7 срабатываний на 33 966 результатов (0.02%); headroom/proxy.log: 3 333 из 986 073 токенов (0.34%), avg latency 5246 ms", "Состав контекста (топ-8 сессий): вывод инструментов 45.5% (run_code 33.3 из 34.5 МБ), reasoning 27.5%, аргументы 18.4%"]
resultSummary: "Спроектированы три обратимых изменения и обоснованы измерениями: P1 — компакция с порога 678K до 500K и retain 119K→60K (−8…−10%); P2 — потолок сессии 300–400 шагов, поскольку 4 сессии ≥2000 шагов дают 26% счёта (−15…−20% по модели перезапуска); P3 — проекция вывода run_code с 8 КБ, баннером и spill-файлом (−5…−7%), новый плагин на tools/post-execute по образцу RTK. Показано, что уже стоящие слои на этой нагрузке почти не работают: RTK 0.02%, headroom 0.34% при +5.2 с, прунер срабатывает только при компакции; поэтому они не входят в план. Отдельно зафиксировано, что дефект порога из документа 22.10 в установленной 0.2.1-rc.2 исправлен — иначе снижать thresholdRatio было бы бессмысленно. Цель −25…30% счёта, протокол проверки и критерии откатa заданы; ничего не внедрялось."
scope: ["docs/CONTEXT-ECONOMY-DESIGN.md (новый документ)", "чтение $DSH_HOME/profiles/web/cordis.patch.yml, пакетов dsh-compaction-*, plugins/rtk, plugins/image-window, $DSH_HOME/headroom/*", "чтение логов сессий из $DSH_HOME/sessions (анализ в .usage-analysis/)"]
---

Спроектировать (не внедряя) оптимальный набор изменений, сокращающих расход на контекст в этом деплое: учесть уже установленные слои сжатия (RTK, headroom, image-window, tool-result-pruner, compaction-basic), измерить фактическую картину по логам сессий и создать документ с эффектами, рисками, точками правки, протоколом проверки и отката.

Migrated from .dsh/taskboard.json (task task-mwdkg626-yp16ei, revision 5).
