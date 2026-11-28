---
id: TEST-110
kind: test
title: "Документация ровно три и без состояния"
status: unverified
revision: 2
createdAt: 2026-11-28T13:21:24.835Z
updatedAt: 2026-11-28T13:21:29.398Z
authorRole: backend
caseId: dokumentatsiya-rovno-tri-i-bez-sostoyaniya
command: "node --test scripts/check-documentation.test.mjs"
evidenceRefs: [mx0fvfqf-s227l-1:green:pass]
frozenHash: a2799181ece9e00c16a00796e20d89d5fcab89948c822efafd270d6f49664bbd
reqId: REQ-297
testPath: scripts/check-documentation.test.mjs
---

docs/ содержит ровно GUIDE, ARCHITECTURE, TERMINOLOGY (PRESET-PLAYBOOKS — вход сборки, cases/ и analysis/ не документация); документ не содержит версии, номера задачи или счётчика и несёт дату проверки не старше связанных файлов и 180 дней.
