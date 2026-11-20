---
id: TEST-078
kind: test
title: "Spill read-back returns the projected full text"
status: verified
revision: 3
createdAt: 2026-11-20T11:57:26.151Z
updatedAt: 2026-11-20T12:02:35.102Z
authorRole: backend
caseId: spill-read-back-returns-the-projected-full-text
command: "node plugins/run-code-projection/proof/proof.mjs"
evidenceRefs: [mwoxcmdl-w6x7k-1:red:fail, mwoxj62t-02oa7-1:green:pass]
frozenHash: 6f58e03d4329331dd371b492e07f48f583a36601b661d7f27d39cba1d334fa37
reqId: REQ-172
testPath: plugins/run-code-projection/proof/proof.mjs
---

A tool result that was projected into a spill file can be read back whole by the agent through the same tools/post-execute listener: a read whose file_path lies in .dsh/spill is never projected again at any size, and read carries its own 64 KiB floor so an ordinary document arrives complete (REQ-172, REQ-128).
