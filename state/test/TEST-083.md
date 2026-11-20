---
id: TEST-083
kind: test
title: "The ARCHITECT role defaults to gpt-6.2-sol"
status: unverified
revision: 1
createdAt: 2026-11-20T14:23:34.498Z
updatedAt: 2026-11-20T14:23:34.498Z
authorRole: BACKEND
caseId: the-architect-role-defaults-to-gpt-6-2-sol
command: ""
evidenceRefs: []
frozenHash: c48251aa38e4b266f680a0234e973ff6396ec3302d0332729ac9828434edc6d5
reqId: REQ-131
testPath: ""
---

Роль ARCHITECT по умолчанию идёт на openai-codex/gpt-6.2-sol вместо openai-codex/gpt-6.2-astra: и правило role-model, и строка flash-guard allowedRoutes называют sol. Фолбэк deepseek-official/deepseek-flash с усилием max и правило «явный выбор модели человеком не перезаписывается» остаются. Модель gpt-6.2-astra остаётся в каталоге провайдера openai-codex (llm-pi-ai), но не как маршрут по умолчанию.
