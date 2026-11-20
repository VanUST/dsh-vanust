---
id: TASK-254
kind: task
title: "Доказательство пресета: скрипт, второй сервер, ТЗ про prefix caching"
status: done
revision: 3
createdAt: 2026-11-20T09:16:45.133Z
updatedAt: 2026-11-20T10:03:01.806Z
acceptance:
  - text: "scripts/presentation-proof.mjs PASS, негативный контроль красный"
    done: false
  - text: "второй сервер на свободном порту показывает Presentation maker в списке"
    done: false
  - text: "сессия с пресетом presenter собирает колоду про prefix caching"
    done: false
  - text: "каждый слайд снят, консоль без ошибок, содержимое понятно вне мира LLM"
    done: false
boardId: task-mworlwqz-1dpoqw
inline: true
nonScope: ["правки кода рендерера и профиля (свои задачи)", "работающий сервер :3080"]
reqIds: [REQ-159, REQ-160, REQ-162]
resultArtifacts: [docs/cases/presentation-deck-and-board-contract.json, docs/cases/prefix-caching-deck-for-a-stranger.json, state/test/TEST-077.md, reports/prefix-caching/prefix-caching.html, reports/presenter-proof/tz-08.png]
resultEvidence: ["node plugins/test-cases/bin/cases.mjs run --id presentation-deck-and-board-contract --red --control before-axis-fix -> FAIL exit 1; run -> PASS exit 0; case status verified", "второй сервер 3081: Presentation maker между UX/UI и Backend (reports/presenter-proof/preset-menu.png)", "сессия session-d6651fa0, preset presenter: reports/prefix-caching/prefix-caching.html (10 слайдов) + storyboard.md 8969 B", "Chromium: reports/presenter-proof/tz-01..10.png, 0 ошибок консоли, печать 11 страниц шагом 900px", "анализ presenter-role: 9/9 требований proven, completion ok"]
resultSummary: "Пресет доказан на деле: кейс presentation-deck-and-board-contract прошёл red (негативный контроль before-axis-fix, exit 1) и green (exit 0) и записан verified с TEST-077; второй сервер на 3081 показал Presentation maker в композиции; сессия с этим пресетом собрала колоду про prefix caching из 10 слайдов со сторибордом, корень снял и прочитал каждый слайд."
scope: [scripts/presentation-proof.mjs, "reports/presenter-proof/**", "docs/cases/**"]
steps: ["Написать scripts/presentation-proof.mjs с рендером, негативным контролем и Chromium", "Прогнать доказательство и сохранить артефакты", "Собрать overlay-патч и поднять второй сервер, проверить пресет в браузере", "Дать свежей сессии ТЗ про prefix caching и дождаться колоды", "Снять каждый слайд, прочитать контент, записать кейс требования"]
stepsDone: 5
---

Доказать пресет на деле: скрипт presentation-proof.mjs проверяет контракт рендера и негативный контроль, второй сервер с overlay-патчем показывает Presentation maker в выборе композиции, свежая сессия с этим пресетом получает тестовое ТЗ про prefix caching и собирает колоду, которую корень читает и снимает в браузере, и записать требование владельца кейсом.
