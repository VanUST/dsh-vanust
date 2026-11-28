---
id: TASK-324
kind: task
title: "Record the ledger with the projection the reloaded build wrote"
status: done
revision: 7
createdAt: 2026-11-26T10:07:07.993Z
updatedAt: 2026-11-26T12:24:12.594Z
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
preset: backend
resultEvidence: ["commit c627dde: 9 state/ files, +112/-24; the committed snapshot carries '- active agents: 1' at journal 1826", "commit 157fa0a: 7 state/ files, +17/-21; the same line at journal 1827", "state-merge --check said no merge in progress; both messages say so; read-back prints 0 paths outside state/ for each commit", "ls-remote refs/heads/main = 157fa0acf7fdbb71c32d0df7b4844d405f93515b = git rev-parse HEAD", "state/ clean afterwards; no product file dirty; project-state 0.1.17 and state-feed 0.1.8 unchanged; make verify exit 0"]
resultSummary: "The ledger is recorded with the projection the reloaded build wrote: two state-only commits (c627dde at journal 1826 and 157fa0a at 1827, the second because the live taskboard wrote one more transition), both staged by explicit path with a read-back of zero paths outside state/. The committed snapshot carries '- active agents: 1', remote main equals local HEAD at 157fa0a, state/ is clean, no product file or version was touched, and make verify is green."
role: BACKEND
scope: ["state/ — the ledger rows and the projections the running product wrote", "the commit and its push"]
---

Record the ledger as it now stands after the restart: the live projections were rewritten by the running 0.1.17 and carry the agents line, and the rows moved since b17da57. Stage state/ by explicit path, confirm the committed snapshot bytes contain '- active agents:' (they were written by the product, not by hand), commit with a message saying whether a cross-machine merge existed, push, and prove the remote main equals local HEAD with state/ clean afterwards.
