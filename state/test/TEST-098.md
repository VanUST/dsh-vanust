---
id: TEST-098
kind: test
title: "devops lane and scope overlap through delegate_task"
status: verified
revision: 9
createdAt: 2026-11-27T11:16:44.219Z
updatedAt: 2026-11-27T11:20:39.938Z
authorRole: tester
caseId: devops-lane-and-scope-overlap-through-delegate-task
command: "node tests/devops-lane/driver.mjs"
evidenceRefs: [mwyvzai9-7ogpi-1:red:fail, mwyvzgeh-gqvme-1:red:fail, mwyvzme8-mu5hq-1:red:fail, mwyvzpls-x5s1e-1:green:fail, mwyw1037-ihoz7-1:green:pass, mwyw46ys-esorg-1:green:pass]
frozenHash: ee3f002d81fee23e8ee8e1e2ab4add59b2b3cfb0de9d534b4402c4311dd78314
reqId: REQ-257
testPath: tests/devops-lane/driver.mjs
---

REQ-257 is primary: one live deployment task per chat - delegate_task refuses a second live devops task with devops_lane_busy naming the open one, while attaching to that task stays allowed. The same case also protects REQ-256 (profile declares preset-devops at order 35 with the required tool-todo `allowParallelInProgress`, and DEVOPS/DEPLOYMENT/OPS resolve to it), REQ-258 (ROOT_POLICY names the running deployment as a serialising resource, DEVOPS as its owner, and running children before a restart), REQ-259 (the preset composes from profile rows), REQ-260 (the shipped configuration and gates stay true), REQ-261/REQ-262 (High reasoning default in the profile and on the started child), REQ-263 (the Development rules block in the root policy), and REQ-264 (the scope-overlap guard): an active task's path claim refuses a second task whose scope names the same file or a containing directory (scope_overlap), while review rows, disjoint files, prose and attaches are allowed. The case does NOT claim the make verify/make test/tarball criteria of REQ-259/REQ-260 or the documentation criteria of REQ-262 - those were not run here.
