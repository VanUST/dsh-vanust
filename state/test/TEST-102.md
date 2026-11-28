---
id: TEST-102
kind: test
title: "Хронологический порядок: шаг после выхода, а не рядом"
status: unverified
revision: 1
createdAt: 2026-11-27T14:02:15.008Z
updatedAt: 2026-11-27T14:02:15.008Z
authorRole: orchestrator
caseId: khronologicheskiy-poryadok-shag-posle-vykhoda-a-ne-ryadom
command: ""
evidenceRefs: []
frozenHash: 9b2497035f4ea669ae077df8c4ba6aeb1a0761d5b6c3a21f05a14753b29baf25
reqId: REQ-273
testPath: ""
---

Владелец требует, чтобы оркестратор соблюдал хронологический порядок там, где он необходим: выкатка актуальной версии и её тестировка идут друг за другом, а не параллельно, иначе тестировщик меряет отчасти старое приложение; и чтобы таких цепей было не «на память», а по правилу.
