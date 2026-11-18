---
id: TEST-060
kind: test
title: "State header shows three counters"
status: verified
revision: 3
createdAt: 2026-11-18T12:46:00.425Z
updatedAt: 2026-11-18T12:46:10.397Z
authorRole: BACKEND
caseId: state-header-shows-three-counters
command: "node --test plugins/project-state-panel/test/counts-and-sort.test.mjs"
evidenceRefs: [mwm47ffw-ghjgq-1:red:fail, mwm47idp-e7ubc-1:green:pass]
frozenHash: 647bef85bc6702ea73af85dd91a4ca9619e291b1c57d09e17b9ee4bdb8240a1a
reqId: REQ-115
testPath: plugins/project-state-panel/test/counts-and-sort.test.mjs
---

The State button in the session header shows three numbers in order — unfinished tasks, active tasks, active subagents — each named in aria-label, with the count area stated: tasks from the workspace projections, subagents from live child sessions of the chat. Zero shows as 0; a read error shows — with the error in title and the button still opens the panel.
