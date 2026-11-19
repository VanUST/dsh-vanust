---
id: TASK-222
kind: task
title: "V1.11b: вернуть строгий гейт пресета в делегатном брифе"
status: done
revision: 2
createdAt: 2026-11-17T15:52:42.583Z
updatedAt: 2026-11-17T15:52:42.583Z
acceptance:
  - text: "Гейт в `plugins/delegation-brief/index.mjs` приведён к канонической форме пяти гейтованных плагинов: инструменты и раздел регистрируются ТОЛЬКО при `preset === 'orchestrator'`; пустой или неизвестный пресет не получает ничего"
    done: false
  - text: "Тест, закреплявший ослабление, заменён тестом «пресет не назван → инструментов нет»"
    done: false
  - text: "`node --test plugins/delegation-brief/test/*.test.mjs` и `make verify` — оба exit 0"
    done: false
  - text: "Отчёт `reports/probes/v111-delegation-brief.md` честно говорит, снят ли живой пруф: headless больше не годен; либо пруф на копии рабочего профиля (второй порт, корневая сессия с пресетом orchestrator, временный `state/` с одним accepted REQ), либо явная пометка «живой пруф не снят, инструмент доказан unit-тестами»"
    done: false
  - text: "Тарбол перепакован"
    done: false
boardId: task-mwkv6sqc-j2gept
nonScope: ["переписывать бриф, возврат, раздел промпта — они приняты", "state/, docs/analysis, профиль :3080", "повторять headless-пруф: он больше не подтверждает видимость инструмента"]
owner:
  kind: agent
  label: BACKEND
  sessionId: d31aa145-06d5-4c8a-a605-590193af752c
ownerRole: BACKEND
preset: backend
resultEvidence: ["plugins/delegation-brief/index.mjs:160 — presetOf(ctx, agent) !== 'orchestrator' → return (моя проверка)", "node --test plugins/delegation-brief/test/*.test.mjs → 7/7 exit 0", "make verify → exit 0", "тарбол 0.1.3; отчёт содержит раздел «Не снятый живой пруф»"]
resultSummary: "Гейт вернули к канонической форме: инструменты и раздел только у корня с пресетом orchestrator; тест закрепляет «без именованного пресета — ничего». Отчёт честно говорит, что живой пруф не снят."
role: BACKEND
---

Откатить ослабление гейта в плагине делегатного брифа: инструменты и раздел должны появляться только у корневой сессии с пресетом `orchestrator`, как у остальных пяти гейтованных плагинов. Пустой или неизвестный пресет (headless-прогон) не получает ничего — это решение владельца D8, а не деталь реализации. Поправить тест, который закреплял ослабление, заменить его тестом на отсутствие инструментов при неназванном пресете, перепаковать тарбол. Отчёт должен честно сказать, снят ли живой пруф: после отката headless-пруф недействителен, поэтому либо пруф на копии рабочего профиля и втором порту, либо явная пометка «живой пруф не снят».

Migrated from .dsh/taskboard.json (task task-mwkv6sqc-j2gept, revision 7).
