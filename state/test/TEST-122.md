---
id: TEST-122
kind: test
title: "The panel passes axe with no critical violation and its two small texts meet 4.5:1 in both themes"
status: unverified
revision: 1
createdAt: 2026-11-28T17:18:39.302Z
updatedAt: 2026-11-28T17:18:39.302Z
authorRole: ux
caseId: the-panel-passes-axe-with-no-critical-violation-and-its-two
command: "node .tmp/panel-ux/run.mjs verify"
evidenceRefs: []
frozenHash: 99625e9bfbcc0aeae1c1edf02c6a44b6dafd0982f6dd73ac1a560705eacf25ec
reqId: REQ-306
testPath: .tmp/panel-ux/run.mjs
---

In the Project state panel the header's right-column toggle must name an element that exists while the drawer is closed (no axe critical), and the two small texts that failed contrast — the open status chip and the header badge — must read at 4.5:1 or better on the light and the dark theme, without removing the relationship the toggle declares.
