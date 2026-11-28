---
id: TEST-112
kind: test
title: "Повтор запроса даёт те же байты, изменённое сообщение двигает только messages"
status: verified
revision: 3
createdAt: 2026-11-28T13:44:37.929Z
updatedAt: 2026-11-28T13:45:06.828Z
authorRole: backend
caseId: povtor-zaprosa-daet-te-zhe-bayty-izmenennoe-soobshchenie-dvi
command: "node scripts/request-snapshot.mjs"
evidenceRefs: [mx0gpa6e-atvrb-1:red:fail, mx0gpkgq-iui7h-1:green:pass]
frozenHash: bfff62de39fb9aa87d28c948ae9f68dffa650b199ef6d05bcb453988b6eeb9c7
reqId: REQ-298
testPath: scripts/request-snapshot.mjs
---

По шагу видно, что установленный харнесс действительно отправляет: разделы системного промпта с отпечатками, схемы инструментов целиком, сообщения контекста и историю; повтор без изменений повторяет байты тела, а изменение одного фактора называет раздел и первое отличие.
