---
id: TEST-081
kind: test
title: "Kit checks refuse when there is nothing to measure"
status: unverified
revision: 1
createdAt: 2026-11-20T12:09:37.085Z
updatedAt: 2026-11-20T12:09:37.085Z
authorRole: backend
caseId: kit-checks-refuse-when-there-is-nothing-to-measure
command: ""
evidenceRefs: []
frozenHash: ff876a816d15b60f10b29223c5f26d29e01a6cd8afd2d6cea3cee607318cd5b4
reqId: REQ-175
testPath: ""
---

The three kit checks must fail, with a named reason, when their input is empty or broken: context-budget without a session store or session log, schema-lint with no tool matched or no preset parsed, check-portability with an inventory that declares no plugin rows or a mounted row that exists only as a comment. Each run also records its own negative control in its output.
