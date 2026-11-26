---
id: TASK-324
kind: task
title: "Record the ledger with the projection the reloaded build wrote"
status: active
revision: 3
createdAt: 2026-11-26T10:07:07.993Z
updatedAt: 2026-11-26T10:07:13.879Z
acceptance:
  - text: "the ledger commit carries the projection written by the running 0.1.17 (the agents line present in the committed file), quoted from the committed bytes"
    done: false
  - text: "nothing outside state/ is staged; the read-back prints 0 for any other path"
    done: false
  - text: "the push leaves remote main equal to local HEAD, proven by ls-remote against git rev-parse HEAD"
    done: false
  - text: "state/ has no dirty rows afterwards"
    done: false
  - text: "no product file is touched and no version is bumped"
    done: false
boardId: task-mwxe1rsa-l3036m
chore: true
choreReason: "The live projections and the ledger rows have moved since the last ledger commit, and the committed snapshot still lacks the agents line that the reloaded build now writes."
nonScope: ["No product code change", "No install, no kit-update, no restart", "No cleanup of .tools/ scripts from another workstream"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
preset: backend
role: BACKEND
scope: ["state/ — the ledger rows and the projections the running product wrote", "the commit and its push"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: active
---

Record the ledger as it now stands after the restart: the live projections were rewritten by the running 0.1.17 and carry the agents line, and the rows moved since b17da57. Stage state/ by explicit path, confirm the committed snapshot bytes contain '- active agents:' (they were written by the product, not by hand), commit with a message saying whether a cross-machine merge existed, push, and prove the remote main equals local HEAD with state/ clean afterwards.
