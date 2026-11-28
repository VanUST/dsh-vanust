---
id: TEST-128
kind: test
title: "Доставка архитектуры: фрагмент длинной строки, пустой файл отдельно от отсутствующего, дельта при смене несёт раздел"
status: verified
revision: 4
createdAt: 2026-11-28T18:11:41.078Z
updatedAt: 2026-11-28T18:13:03.018Z
authorRole: backend
caseId: dostavka-arkhitektury-fragment-dlinnoy-stroki-pustoy-fayl-ot
command: "node --test plugins/state-feed/test/feed.test.mjs"
evidenceRefs: [mx0q95x6-770ws-1:red:fail, mx0q9863-mxtn8-1:green:pass, mx0qae4k-14h0k-1:green:pass]
frozenHash: 73bba4b66bd21aa4f4830b131882799d4e493bac5afc888c5c6d3bd1cbb95eb0
reqId: REQ-311
testPath: plugins/state-feed/test/feed.test.mjs
---

Оркестратор получает architecture page в первом сообщении: раздел остаётся в бюджете с маркером и путём даже когда страница состоит из одной длинной строки; «файла нет» и «файл пуст» — два названных состояния с разными хешами; правка архитектуры у тёплой сессии приходит дельтой с разделом целиком, а обычная дельта остаётся маленькой.
