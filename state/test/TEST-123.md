---
id: TEST-123
kind: test
title: "The Plan tab shows the whole generated plan after one read and names an empty plan"
status: unverified
revision: 1
createdAt: 2026-11-28T17:37:07.248Z
updatedAt: 2026-11-28T17:37:07.248Z
authorRole: ux
caseId: the-plan-tab-shows-the-whole-generated-plan-after-one-read-a
command: "node .tmp/panel-plan/run.mjs"
evidenceRefs: []
frozenHash: 28b46b47a6422ff7684cf0d3156eb226a13d5c08413dd449bc344eb4a5067be7
reqId: REQ-309
testPath: .tmp/panel-plan/run.mjs
---

Opening the Plan tab in the Project state panel must cost exactly one read of the generated plan view (state/views/plan.md) and no command, must not re-read on a tab switch, must list the initiatives with work left with their stage and confirmed-of-total count, the decisions newest first with their initiative and the open tasks, and must name both an empty plan and a missing plan view in words instead of drawing a blank pane.
