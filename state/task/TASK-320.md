---
id: TASK-320
kind: task
title: "Commit the acceptance group in the gate and the ledger"
status: active
revision: 2
createdAt: 2026-11-26T09:37:04.140Z
updatedAt: 2026-11-26T09:37:05.034Z
acceptance:
  - text: "the gate change and its two documentation lines are one commit, staged by explicit path with a read-back showing nothing else"
    done: false
  - text: "the ledger is its own commit with a message saying whether a cross-machine merge existed"
    done: false
  - text: "both pushes leave remote main equal to local HEAD, proven by ls-remote against git rev-parse HEAD"
    done: false
  - text: "state/ has no dirty rows afterwards and nothing tracked is left unstaged except what another workstream owns"
    done: false
  - text: "the committed tree passes make test 69/69 and make verify"
    done: false
boardId: task-mwxcz484-k6in1y
chore: true
choreReason: "The acceptance group in the gate and the ledger rows it produced are uncommitted, and the gate description in Makefile and README was corrected in the same pass."
nonScope: ["No change to the runner's behaviour or to any test", "No install, no kit-update, no restart", "No cleanup of .tools/ scripts from another workstream"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
preset: backend
role: BACKEND
scope: ["scripts/test-all.mjs, Makefile, README.md", "state/ — the ledger rows", "the two commits and their pushes"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: active
---

Commit and push the acceptance group in the gate together with the ledger. One commit for the gate change — scripts/test-all.mjs plus the two documentation lines in Makefile and README that now describe the group — staged by explicit path; one commit for state/ alone following the repository's ledger rule. Prove both pushes by comparing the remote main with local HEAD, keep the tree clean apart from what another workstream owns, and quote make test and make verify on the committed tree.
