---
id: TEST-108
kind: test
title: "A shell-audit record stops refusing when the file returns, and every close door checks it"
status: verified
revision: 7
createdAt: 2026-11-28T12:49:37.750Z
updatedAt: 2026-11-28T12:51:49.317Z
authorRole: tester
caseId: a-shell-audit-record-stops-refusing-when-the-file-returns-an
command: "node --test test/proof-guard-resolution.test.mjs"
evidenceRefs: [mx0eqkff-0w3rg-1:red:fail, mx0eqn0t-5j7hj-1:green:pass, mx0esm2e-llfey-1:green:pass, mx0etai2-3efed-1:green:pass]
frozenHash: 4491c57dd5cd75e6095cbec64342d65c553e07683b9d234e365da38cfea3d5e8
reqId: REQ-295
testPath: test/proof-guard-resolution.test.mjs
---

REQ-295: a shell-audit record must not refuse forever after the product file is back at its previous content, the owner of the area must be able to take a false record off with a reason, and no close path may skip the check. C01: the record keeps the file's SHA-256 and refuses only while the file matches. C02: the area owner resolves a false record with a reason; a surviving edit still refuses. C03: the acceptance is not softened and close, closeMany and task_batch all apply the check.
