---
id: TEST-100
kind: test
title: "dsh web on another port is not this port server"
status: verified
revision: 3
createdAt: 2026-11-27T13:04:52.042Z
updatedAt: 2026-11-27T13:05:08.833Z
authorRole: backend
caseId: dsh-web-on-another-port-is-not-this-port-server
command: "node --test scripts/test/kit-update-server-scope.test.mjs"
evidenceRefs: [mwyzubgw-p2q1n-1:red:fail, mwyzuhvt-i2q0a-1:green:pass]
frozenHash: f262fea1a9c10332bd79d2bd529ee6c8a745523c350914c9750009439e31e92c
reqId: AC-1
testPath: scripts/test/kit-update-server-scope.test.mjs
---

kit-update --check --json must answer two questions from one /proc scan: the profile's port is busy only when a dsh web declared that port (or answers HTTP there), and the pids offered to a restart are only that port's. Any dsh web on the machine still blocks a harness replacement, and the check's own process tree is never named.
