---
id: TEST-113
kind: test
title: "План доходит до модели: state/plan.yaml в L1 и в хеше состояния"
status: verified
revision: 3
createdAt: 2026-11-28T13:47:36.091Z
updatedAt: 2026-11-28T13:47:40.227Z
authorRole: backend
caseId: plan-dokhodit-do-modeli-state-plan-yaml-v-l1-i-v-kheshe-sost
command: "node --test plugins/state-feed/test/plan.test.mjs"
evidenceRefs: [mx0gt3l8-g0m7v-1:red:fail, mx0gt4bg-ck0ue-1:green:pass]
frozenHash: 7d63a966830192c9c3eb79d0a627f7ea148e250c02e8088d0a073ac53adcffb8
reqId: REQ-297
testPath: plugins/state-feed/test/plan.test.mjs
---

План собирается генератором видов и доходит до модели: первое сообщение сессии несёт сводку плана, повторный прогон даёт те же байты, а изменение плана меняет состояние (иначе дельта не появится).
