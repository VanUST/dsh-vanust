---
id: TEST-077
kind: test
title: "Колода и доска презентации: контракт рендера"
status: verified
revision: 1
createdAt: 2026-11-20T10:02:26.793Z
updatedAt: 2026-11-20T10:02:26.793Z
authorRole: orchestrator
caseId: presentation-deck-and-board-contract
command: "node scripts/presentation-proof.mjs"
evidenceRefs: [presentation-deck-and-board-contract:red:fail, presentation-deck-and-board-contract:green:pass]
reqId: REQ-160
testPath: scripts/presentation-proof.mjs
---

Кейс presentation-deck-and-board-contract покрывает REQ-155, REQ-156, REQ-157, REQ-158, REQ-159, REQ-160, REQ-161, REQ-162 и REQ-163: колода и доска рендерятся в один автономный HTML-файл. Прогон доказательства — scripts/presentation-proof.mjs; красный прогон — негативный контроль before-axis-fix (проверка подгонки оси падает), зелёный — обычный прогон.
