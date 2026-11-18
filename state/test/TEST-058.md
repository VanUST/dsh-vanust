---
id: TEST-058
kind: test
title: "Session header drops the Tasks button"
status: verified
revision: 3
createdAt: 2026-11-18T12:30:35.650Z
updatedAt: 2026-11-18T12:30:47.998Z
authorRole: BACKEND
caseId: session-header-drops-the-tasks-button
command: "node --test plugins/taskboard/test/panel-navigation.test.mjs"
evidenceRefs: [mwm3nmfd-jwwml-1:red:fail, mwm3nqpv-ryvir-1:green:pass]
frozenHash: 98406451d30c3ea62ed4a1ef2282a6a70ca431551393bb36a40c92aba5c54598
reqId: REQ-109
testPath: plugins/taskboard/test/panel-navigation.test.mjs
---

The session header no longer shows a Tasks button: the taskboard client registers no conversation.session.header.actions entry, while the Tasks panel registration in main stays.
