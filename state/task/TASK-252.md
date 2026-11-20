---
id: TASK-252
kind: task
title: "Плагин presentation: колода и доска из спецификации"
status: done
revision: 3
createdAt: 2026-11-20T09:16:38.572Z
updatedAt: 2026-11-20T09:53:32.073Z
acceptance:
  - text: "presentation и dashboard пишут один автономный HTML-файл"
    done: false
  - text: "пять тем, восемь раскладок слайдов, анимация появления и фрагментов"
    done: false
  - text: "негативный контроль: испорченная спецификация даёт ok:false и errors"
    done: false
  - text: "проверено в Chromium: консоль без ошибок, стрелки работают, печать по слайдам"
    done: false
boardId: task-mworlrme-9d24kq
inline: true
nonScope: ["профиль и пресет (отдельная задача)", "работающий сервер :3080"]
reqIds: [REQ-156, REQ-157, REQ-163]
resultArtifacts: [plugins/presentation/, plugins/cc-dsh-presentation-0.2.2.tgz, scripts/presentation-proof.mjs, reports/presenter-proof/deck-01.png, reports/presenter-proof/board.png, docs/PRESENTATION-TOOLCHAIN.md]
resultEvidence: ["node scripts/presentation-proof.mjs -> PASS 62/62, exit 0: рендер, автономность (нет src=, @import, url(, http), пять разных акцентов, правила печати, негативные контроли", "Chromium: 0 ошибок консоли, стрелки листают, фрагмент раскрывается по одному, O/N работают, печать даёт 10 страниц, тот же документ живёт в iframe sandbox=allow-scripts", "node scripts/schema-lint.mjs -> 0 red, preset presenter 6 инструментов набора, 790 B", "git commit 513e01b + 3ee9152: плагин и правки после реального прогона"]
resultSummary: "Плагин @cc/dsh-presentation собран: два инструмента (presentation, dashboard), пять тем на одном слое токенов, восемь типов слайдов, движение на CSS/WAAPI с фрагментами и счётом чисел, четыре SVG-графика без зависимостей, автономный HTML без внешних ссылок, README и тарбол."
scope: ["plugins/presentation/**", plugins/inventory.json, docs/PRESENTATION-TOOLCHAIN.md]
steps: ["Восстановить и расширить theme.css: пять тем и компоненты", "Написать charts.mjs: bar, line, donut, sparkline без зависимостей", "Написать render-deck.mjs: восемь раскладок, фрагменты, плеер, печать", "Написать render-board.mjs: плитки KPI, графики, списки", "Написать plugin-presentation.mjs и index.js: два инструмента и гейт пресета", "Собрать README и упаковать тарбол"]
stepsDone: 6
---

Собрать плагин @cc/dsh-presentation 0.2.0: два инструмента (presentation — колода, dashboard — доска), общая библиотека стилей на пять тем, собственный движок анимации на CSS/WAAPI, SVG-графики без внешних зависимостей, автономный HTML-файл на выходе, README и упаковка в тарбол.
