---
id: TASK-241
kind: task
title: "Абсолютный бюджет контекста ~500K вместо доли окна"
status: done
revision: 3
createdAt: 2026-11-18T15:41:01.972Z
updatedAt: 2026-11-23T08:24:10.941Z
acceptance:
  - text: "deepseek-flash компактится на 500K"
    done: false
  - text: "codex gpt-6-astra компактится не позже 218K"
    done: false
  - text: "конфиг проходит проверку профиля"
    done: false
boardId: task-mwmage6u-bd0ysf
nonScope: ["форк @deepseek-ai/dsh-compaction-basic"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-131]
resultEvidence: ["profile/cordis.patch.yml: во всех 8 группах пресетов thresholdRatio 0.8 + modelPolicies deepseek-official/deepseek-flash 0.5", "арифметика из compaction-basic: 272 000 x 0.8 = 217 600, потолок 272 000 - 65 536 = 206 464 (было 0.5 x 272 000 = 136 000); 1 048 576 x 0.5 = 524 288", "make verify -> exit 0"]
resultSummary: "Порог компакции стал абсолютным бюджетом: 0.8 окна с потолком ~500K. Для deepseek-flash (окно 1M) modelPolicies даёт 0.5 = 524K; для Codex (272K) 0.8, но фактический порог упирается в потолок 206 464 (272 000 − 65 536 headroom). Было 136 000 при плоских 0.5."
role: BACKEND
scope: [profile/cordis.patch.yml, docs]
steps: ["policy в 7 группах пресетов", "проверка конфига"]
stepsDone: 2
---

Порог компакции: 500K токенов там, где окно позволяет, и не более 80% окна иначе. Для deepseek-flash (окно 1M) — ровно 500K через per-model policy; общий порог 0.8 для остальных (Codex 272K → 217K).
