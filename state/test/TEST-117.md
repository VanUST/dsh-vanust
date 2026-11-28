---
id: TEST-117
kind: test
title: "Снятие связи в ядре состояния переживает переигрывание журнала"
status: verified
revision: 3
createdAt: 2026-11-28T14:54:25.413Z
updatedAt: 2026-11-28T14:54:31.934Z
authorRole: backend
caseId: snyatie-svyazi-v-yadre-sostoyaniya-perezhivaet-pereigryvanie
command: "node --test plugins/project-state/test/core.test.mjs"
evidenceRefs: [mx0j72j2-zvzxd-1:red:fail, mx0j73ht-881zp-1:green:pass]
frozenHash: b5cb6133e665100bec8a48c330344b967ac4932c8a072a37d0c53e153047bea5
reqId: REQ-303
testPath: plugins/project-state/test/core.test.mjs
---

Ядро состояния умеет снимать одну связь под блокировкой и записывает это событием журнала: файл и результат переигрывания совпадают, снятая связь не возвращается, соседние связи и добавление новой связи работают.
