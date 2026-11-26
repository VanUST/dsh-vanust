---
id: TASK-332
kind: task
title: "Push what is uncommitted, ledger only"
status: active
revision: 2
createdAt: 2026-11-26T13:26:05.457Z
updatedAt: 2026-11-26T13:26:06.236Z
acceptance:
  - text: "the working tree is reported exactly: every modified, deleted and untracked path, split into product and state/"
    done: false
  - text: "if state/ is dirty it goes into its own ledger commit with a message saying whether a cross-machine merge existed; nothing outside state/ is staged in it"
    done: false
  - text: "if any product file is dirty, it is reported and NOT committed without a decision, naming the file and its change"
    done: false
  - text: "the push leaves remote main equal to local HEAD, proven by ls-remote against git rev-parse HEAD, and the tree afterwards carries no state/ rows"
    done: false
  - text: "make verify is green on the final tree"
    done: false
boardId: task-mwxl5mmd-okbg5v
chore: true
choreReason: "The owner asked to push the changes; the ledger moved after the last commit and the tree must be checked before anything is pushed."
nonScope: ["No product change", "No install, no restart", "No cleanup of the other workstream's .tools probes"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
preset: backend
role: BACKEND
scope: ["git status and the read-back of what is dirty", "state/ — the ledger commit if it is dirty, and its push"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: active
---

Push whatever is actually uncommitted. Read the tree first and report it exactly, split into product files and state/ rows. The ledger almost certainly moved since 53c6bca because tasks were closed, so commit state/ alone with a message that says whether a cross-machine merge existed, push, and prove remote main equals local HEAD. If anything outside state/ is dirty, stop and report it with the file and the change instead of committing it; the last three commits carried everything else and a stray product edit now would be someone else's work in flight.
