---
id: TEST-118
kind: test
title: "Outline launches the npm shim through PATHEXT and cmd.exe, and refuses when it is absent"
status: verified
revision: 3
createdAt: 2026-11-28T16:17:23.608Z
updatedAt: 2026-11-28T16:17:40.712Z
authorRole: backend
caseId: outline-launches-the-npm-shim-through-pathext-and-cmd-exe-an
command: "node --test plugins/outline/test/outline-shim.test.mjs"
evidenceRefs: [mx0m5yb9-7gu8y-1:red:fail, mx0m6106-ixdox-1:green:pass]
frozenHash: 7ecd5859e402e29427b9d610dbf04e531263b7e34bd029d53859897829294415
reqId: REQ-009
testPath: plugins/outline/test/outline-shim.test.mjs
---

REQ-009: the outline tool finds the code-skeleton-mcp that npm installs as a .cmd shim on Windows and calls it with its arguments; a PATH without that shim degrades to the named refusal instead of a tool that cannot start.
