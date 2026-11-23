---
id: TASK-273
kind: task
title: "Фрагменты внутри SVG: схема заполняется по ячейкам"
status: done
revision: 3
createdAt: 2026-11-20T16:32:45.012Z
updatedAt: 2026-11-20T16:32:55.136Z
boardId: task-mwp76j62-meqxko
inline: true
reqIds: [REQ-156, REQ-159]
resultEvidence: ["до правки три группы с data-frag внутри SVG имели один и тот же x=125 (скрин reports/presenter-proof/probe-frag-partial.png)", "после правки: 212, 604, 996 — каждая группа на своём месте, раскрывается по одному нажатию (probe-frag-svgfix.png)", "node scripts/presentation-proof.mjs -> PASS 68/68 дважды подряд", "CASE_NEGATIVE_CONTROL=before-svg-fragment-fix -> FAIL, exit 1: проверка координат падает (125, 125, 125)", "make verify -> exit 0, 19/19; коммит 7ff4e72"]
resultSummary: "Фрагмент внутри SVG теперь раскрывает по одной ячейке и не теряет координаты: CSS-появление ограничено HTML-блоками, в SVG работает только прозрачность. Доказательство выросло до 68 проверок, кейс получил второй негативный контроль и остался verified."
scope: [plugins/presentation/theme.css, scripts/presentation-proof.mjs, docs/cases/presentation-deck-and-board-contract.json]
steps: ["Воспроизвести: три группы с data-frag внутри SVG съезжают в одну точку", "Ограничить появление фрагмента HTML-блоками и оставить в SVG только прозрачность", "Добавить пять проверок и контроль before-svg-fragment-fix", "Перезаписать red→green и переупаковать плагин"]
stepsDone: 4
---

Дать роли возможность строить схему внутри одного слайда по ячейкам: фрагмент внутри SVG должен раскрываться своим нажатием и сохранять собственные координаты, чтобы колода могла показать пополнение префиксного кэша. Правка CSS + пять проверок в доказательстве + второй негативный контроль кейса.
