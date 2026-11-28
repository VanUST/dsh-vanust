---
id: TEST-101
kind: test
title: "dsh web without --port is named for the port it listens on"
status: verified
revision: 3
createdAt: 2026-11-27T13:08:57.930Z
updatedAt: 2026-11-27T13:09:16.558Z
authorRole: backend
caseId: dsh-web-without-port-is-named-for-the-port-it-listens-on
command: "node --test scripts/test/kit-update-server-scope.test.mjs"
evidenceRefs: [mwyzzkpo-r072m-1:red:fail, mwyzzrdj-he173-1:green:pass]
frozenHash: f262fea1a9c10332bd79d2bd529ee6c8a745523c350914c9750009439e31e92c
reqId: AC-1
testPath: scripts/test/kit-update-server-scope.test.mjs
---

A dsh web started without --port (the composed port) is attributed to the TCP port it actually listens on, read from /proc/net/tcp and the process's own descriptors, so `dsh web --restart` can stop it. A portless process that listens nowhere is machine-wide evidence only and appears in no port's pid list; the check's own process tree is never named; the harness-replacement gate still sees every dsh web on the machine.
