---
id: TEST-106
kind: test
title: "An unconfirmed tail keeps the confirmed row and a damaged complete record is refused"
status: verified
revision: 29
createdAt: 2026-11-28T11:09:36.310Z
updatedAt: 2026-11-28T12:49:51.302Z
authorRole: tester
caseId: a-torn-last-record-keeps-the-confirmed-row-and-the-next-allo
command: "node --test --test-name-pattern=AC-2 test/write-integrity.test.mjs"
evidenceRefs: [mx0b6rro-99qms-1:red:fail, mx0bfwq7-1f66y-1:red:fail, mx0bn21o-2t1h0-1:red:fail, mx0btvvp-uf5wp-1:red:fail, mx0byakv-k91cq-1:red:fail, mx0cb06t-eptzn-1:green:pass, mx0ctfly-7rlhd-1:red:fail, mx0cwkg9-fy7h1-1:red:fail, mx0d43xw-09fw7-1:green:pass, mx0dexyp-hy350-1:red:fail, mx0dk1oq-r0he0-1:red:fail, mx0dmu4v-sh68p-1:red:fail, mx0dp62i-dvnjx-1:red:fail, mx0e7rot-k0uy7-1:green:pass, mx0e85kr-dpenq-1:red:fail, mx0e8but-87jcq-1:green:pass, mx0eqrjd-wief2-1:green:pass]
frozenHash: 051ac54a4ef8a53864f3955d55ffe7e8f7e6a42c4f751b65863d3950384efe83
reqId: REQ-294
testPath: test/write-integrity.test.mjs
---

REQ-294: confirmed board changes survive an interrupted write and the close does not let manual edits through. AC-2: with an incomplete last record the confirmed record stays whole; after a restart the last confirmed row is visible through the service, a repeated allowed change is saved and reopening sees it; damage to a complete record is refused, not rolled back in silence.
