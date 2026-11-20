---
id: TEST-086
kind: test
title: "A command pinned to one tree is refused"
status: verified
revision: 3
createdAt: 2026-11-20T14:57:42.896Z
updatedAt: 2026-11-20T14:58:08.351Z
authorRole: backend
caseId: a-command-pinned-to-one-tree-is-refused
command: "node --test plugins/test-cases/test/run-cwd-pinned.test.mjs"
evidenceRefs: [mwp3sm9x-mstf9-1:red:fail, mwp3swi3-iwo8k-1:green:pass]
frozenHash: dee0fa6340aeca9debd8e76a3e32220c26edd3d55e26137c9400bd1d3b03bc7a
reqId: REQ-181
testPath: plugins/test-cases/test/run-cwd-pinned.test.mjs
---

A case whose runCommand starts with cd /... or carries an absolute path cannot be registered and cannot be saved through case_update; the refusal names the reason and offers the relative-command-plus-cwd route, and a case already recorded that way stays readable (REQ-181).
