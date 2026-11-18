---
id: TEST-059
kind: test
title: "Session header drops the Design map button"
status: verified
revision: 3
createdAt: 2026-11-18T12:30:36.416Z
updatedAt: 2026-11-18T12:30:49.008Z
authorRole: BACKEND
caseId: session-header-drops-the-design-map-button
command: "node --test plugins/taskboard/test/panel-navigation.test.mjs"
evidenceRefs: [mwm3nn8b-k3cmu-1:red:fail, mwm3nrgp-9iazk-1:green:pass]
frozenHash: 44ea76a45b4d5c825d980a8e8a68cf1580de4b3cafbdd4757c19f28c7dedf058
reqId: REQ-110
testPath: plugins/taskboard/test/panel-navigation.test.mjs
---

The session header no longer shows a Design map button: the designmap client registers no conversation.session.header.actions entry, the built client.js comes from client/entry.jsx, and the Design map panel registration in main stays.
