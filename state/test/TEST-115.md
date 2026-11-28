---
id: TEST-115
kind: test
title: "План показывает решения журнала и остаётся в бюджете 4096 B"
status: verified
revision: 3
createdAt: 2026-11-28T14:04:17.542Z
updatedAt: 2026-11-28T14:04:25.477Z
authorRole: backend
caseId: plan-pokazyvaet-resheniya-zhurnala-i-ostaetsya-v-byudzhete-4
command: "node --test plugins/project-state/test/views.test.mjs"
evidenceRefs: [mx0hekh8-iqc68-1:red:fail, mx0henjl-4qokf-1:green:pass]
frozenHash: 79483639767f3040761881a5e0b1b25856140c5963656b4649e62b06804e4d0c
reqId: REQ-303
testPath: plugins/project-state/test/views.test.mjs
---

Долгосрочный порядок работ и условия остановки живут в журнале: DECISION, связанное с REQ, видно в сгенерированном плане (state/plan.yaml и state/views/plan.md) с инициативой из записи анализа, а plan.yaml не превышает 4096 B даже когда решений становится много.
