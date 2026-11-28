---
id: TEST-107
kind: test
title: "The close accepts a legal change and refuses a lone edit"
status: verified
revision: 27
createdAt: 2026-11-28T11:09:42.459Z
updatedAt: 2026-11-28T12:49:52.723Z
authorRole: tester
caseId: the-close-accepts-a-legal-change-and-refuses-a-lone-edit
command: "node --test --test-name-pattern=AC-3 test/write-integrity.test.mjs"
evidenceRefs: [mx0b6sqg-zzeo8-1:red:fail, mx0bfxqv-z7mo1-1:red:fail, mx0bn30x-ks7t0-1:red:fail, mx0btwym-soi67-1:red:fail, mx0bybm0-ysmci-1:red:fail, mx0cb16o-bha34-1:green:pass, mx0d4561-nuspr-1:green:pass, mx0d4u28-nhf3e-1:red:fail, mx0d54g1-j2qvp-1:green:pass, mx0derym-afc8c-1:red:fail, mx0djubj-4ky4j-1:red:fail, mx0dmvc2-9nqq3-1:red:fail, mx0dp79m-x44vm-1:red:fail, mx0e7swm-cid33-1:green:pass, mx0e86js-8bf5o-1:red:fail, mx0e8d11-wu6tx-1:green:pass, mx0eqso3-nvd4b-1:green:pass]
frozenHash: b7440782ca8e93b8a0633e95ff3ca674f0012282c3f2baae28368bc8ba5eef12
reqId: REQ-294
testPath: test/write-integrity.test.mjs
---

REQ-294: confirmed board changes survive an interrupted write and the close does not let manual edits through. AC-3: after a legal row change the close refuses a lone edit of the row or of a whole journal event; a lagging export is not tampering; existing consistent records and old rows with the previous journal need no mass rewrite.
