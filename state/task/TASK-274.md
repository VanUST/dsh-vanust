---
id: TASK-274
kind: task
title: "Блок motion: анимация по часам вместо библиотеки"
status: done
revision: 3
createdAt: 2026-11-20T16:48:13.782Z
updatedAt: 2026-11-20T16:48:25.871Z
boardId: task-mwp7qic0-60o62r
inline: true
reqIds: [REQ-156]
resultEvidence: ["node scripts/presentation-proof.mjs -> PASS 83/83 (12 проверок сцены: старт на входе, середина трека, конец трека, ожидание задержки, P, P, R, печать, reduced motion, ошибка неизвестной цели)", "CASE_NEGATIVE_CONTROL=motion-idle -> FAIL (6 animations, 0 running), exit 1; кейс перезаписан red→green и остался verified", "демонстрация: reports/presenter-proof/motion-demo.html + motion-demo-1.png (1,5 с: префилл, кэш наполняется) и motion-demo-2.png (4,4 с: три токена и девять пар)", "make verify -> exit 0, 19/19; schema-lint 0 red; коммит 8fa76c2"]
resultSummary: "Блок motion добавлен: сцена с data-id, треки с абсолютным временем, синхронные подписи, прогресс и часы, пауза (P) и повтор (R), печать даёт конечное состояние, reduced motion тоже. Рантайм — Element.animate(), библиотеки нет; плеер целиком 16 КБ исходника. Доказательство 83/83, третий негативный контроль motion-idle краснеет."
scope: ["plugins/presentation/**", scripts/presentation-proof.mjs, docs/cases/presentation-deck-and-board-contract.json, docs/PRESENTATION-TOOLCHAIN.md, plugins/skills/skills/visual-explanations.md]
steps: ["Спроектировать форму спецификации: scene + tracks + captions + autoplay/loop/pace", "Написать рантайм плеера на Element.animate с паузой, повтором и часами", "Написать рендер блока и стили, включая печать и reduced motion", "Добавить проверки и контроль motion-idle, перезаписать red→green", "Обновить README, документ о выборе инструментов и навык, переупаковать", "Собрать демонстрацию префилл → кэш → декод"]
stepsDone: 6
---

Добавить в плагин презентаций инструмент анимации по часам: блок motion (сцена + таймлайн), рантайм на Web Animations без библиотеки, синхронные подписи, пауза/повтор/прогресс, корректное поведение при печати и reduced motion; доказать прогоном и негативным контролем.
