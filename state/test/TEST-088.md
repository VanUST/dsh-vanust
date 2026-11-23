---
id: TEST-088
kind: test
title: "The project ledger merges across two machines"
status: verified
revision: 1
createdAt: 2026-11-23T08:44:02.841Z
updatedAt: 2026-11-23T08:44:02.841Z
caseId: project-state-merge-across-machines
command: "node scripts/state-merge-proof.mjs"
evidenceRefs: [mwt0r3r1-vcz2x-1:red:fail, mwt0r5gv-7qjvn-1:green:pass]
frozenHash: 51b20950169da5c69c16e0c35932e39e3555c0d85d17d41eaa2a7017449fb459
reqId: REQ-184
testPath: scripts/state-merge-proof.mjs
---

REQ-184, REQ-185, REQ-186, REQ-187: the project ledger (state/) is one ledger for every machine. Two clones that independently created TASK-002 each keep their row after a pull - one keeps the number and the other is renumbered - one requirement written under two numbers becomes one row, the journal keeps the events of both machines with seq 1..N, the projections are regenerated, the collisions are reported explicitly, verify() and replay() pass after the merge, and a second resolution writes the same bytes.
