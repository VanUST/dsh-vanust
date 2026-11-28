---
id: TEST-111
kind: test
title: "Документов ровно три, и документ не несёт состояния"
status: verified
revision: 3
createdAt: 2026-11-28T13:22:13.030Z
updatedAt: 2026-11-28T13:22:37.464Z
authorRole: backend
caseId: dokumentov-rovno-tri-i-dokument-ne-neset-sostoyaniya
command: "node --test scripts/check-documentation.test.mjs"
evidenceRefs: [mx0fwszi-gdj04-1:red:fail, mx0fwwfj-to6zk-1:green:pass]
frozenHash: a2799181ece9e00c16a00796e20d89d5fcab89948c822efafd270d6f49664bbd
reqId: REQ-297
testPath: scripts/check-documentation.test.mjs
---

Документация состоит из трёх файлов: docs/ держит GUIDE, ARCHITECTURE и TERMINOLOGY, каталоги cases/ и analysis/ — данные, а не документы. Документ не несёт версий, номеров задач и счётчиков «N из M» и называет дату проверки не старше файлов, на которые ссылается.
