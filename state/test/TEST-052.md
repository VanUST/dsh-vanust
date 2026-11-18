---
id: TEST-052
kind: test
title: "Panel navigation returns to chat and toggles sidebars"
status: verified
revision: 5
createdAt: 2026-11-18T12:01:30.876Z
updatedAt: 2026-11-18T12:02:12.514Z
authorRole: BACKEND
caseId: panel-navigation-returns-to-chat-and-toggles-sidebars
command: "node --test plugins/taskboard/test/panel-navigation.test.mjs"
evidenceRefs: [mwm2m9wv-utnxg-1:green:fail, mwm2mu06-0xtbv-1:green:pass, mwm2mufu-0mkj5-1:red:fail, mwm2mz0q-sfy6e-1:green:pass]
frozenHash: 1983678acc0c4a292723412d21c27b12f5d6234e615c9308ee1d788ade5c8d5d
reqId: REQ-025
testPath: plugins/taskboard/test/panel-navigation.test.mjs
---

The state panel offers Back to chat, a left-sidebar toggle and a right-column reset, while the taskboard strip no longer declares sidebar.panellist.
