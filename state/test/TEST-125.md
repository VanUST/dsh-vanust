---
id: TEST-125
kind: test
title: "Архитектура приходит в первом сообщении сессии"
status: verified
revision: 3
createdAt: 2026-11-28T17:44:32.141Z
updatedAt: 2026-11-28T17:44:38.285Z
authorRole: backend
caseId: arkhitektura-prikhodit-v-pervom-soobshchenii-sessii
command: "node --test plugins/state-feed/test/feed.test.mjs"
evidenceRefs: [mx0p9sku-ij9mc-1:red:fail, mx0p9ut9-u6uep-1:green:pass]
frozenHash: 32ba8188994c8b0b1899010ba4fd4712b1bba92d6934d9f974e8b3265bbc6dc5
reqId: REQ-311
testPath: plugins/state-feed/test/feed.test.mjs
---

Оркестратор в первом сообщении сессии получает docs/ARCHITECTURE.md отдельным разделом после плана; раздел ограничен по размеру с явным маркером, содержимое входит в хеш состояния, отсутствие файла названо, а не приводит к падению.
