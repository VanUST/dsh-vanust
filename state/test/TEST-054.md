---
id: TEST-054
kind: test
title: "Back to chat leaves the state panel"
status: verified
revision: 5
createdAt: 2026-11-18T12:06:18.046Z
updatedAt: 2026-11-18T12:33:04.290Z
authorRole: BACKEND
caseId: back-to-chat-leaves-the-state-panel
command: "node --test plugins/taskboard/test/panel-navigation.test.mjs"
evidenceRefs: [mwm2seoa-1apii-1:red:fail, mwm2sfd6-6m9mv-1:green:pass, mwm3nx6o-cduap-1:green:pass, mwm3qnss-10vxe-1:green:pass]
frozenHash: 16690540ad487c210301463df5f1decd8498af758a9d5243c37ddfb4a5ed8a15
reqId: REQ-105
testPath: plugins/taskboard/test/panel-navigation.test.mjs
---

The state panel offers Back to chat, which calls layout.selectPanel(null) and returns the person to the chat.
