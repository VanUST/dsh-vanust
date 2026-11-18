---
id: TEST-055
kind: test
title: "Panel hides left sidebar and closes right"
status: verified
revision: 3
createdAt: 2026-11-18T12:06:18.785Z
updatedAt: 2026-11-18T12:06:28.849Z
authorRole: BACKEND
caseId: panel-hides-left-sidebar-and-closes-right
command: "node --test plugins/taskboard/test/panel-navigation.test.mjs"
evidenceRefs: [mwm2sg2g-6xj6y-1:red:fail, mwm2sgt5-xf2dy-1:green:pass]
frozenHash: 84050141aebd3b719e5ad9f347fb97db5b685b70808d7260d49b19b0b2b1f5d7
reqId: REQ-106
testPath: plugins/taskboard/test/panel-navigation.test.mjs
---

The state panel offers a control that hides the left sidebar (layout.toggleSidebar()) and one that closes the right column (setExpanded(sessionId, false)).
