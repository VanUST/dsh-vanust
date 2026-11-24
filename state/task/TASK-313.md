---
id: TASK-313
kind: task
title: "Commit the project ledger through its own merge pass and push"
status: active
revision: 2
createdAt: 2026-11-24T13:16:21.760Z
updatedAt: 2026-11-24T13:16:23.513Z
acceptance:
  - text: "the merge plan is quoted from scripts/state-merge.mjs --check: which rows would be renumbered, which are one row under two numbers, which were edited on both sides"
    done: false
  - text: "the merge ran and its report is quoted; state/ is staged by the script, not by git add -A"
    done: false
  - text: "the ledger commit exists with a message naming the merge, and the remote HEAD equals the local HEAD after the push"
    done: false
  - text: "the tree is clean for state/ afterwards, quoted from git status"
    done: false
  - text: "nothing outside state/ is included in this commit"
    done: false
boardId: task-mwupxfie-w3hjsq
chore: true
choreReason: "The shipped commit left 84 ledger rows under state/ uncommitted; this repository commits the ledger through its own merge pass, so the board and journal must be merged and committed before the tree is left dirty for the next change."
nonScope: ["No product file changes", "No cleanup of .tools/ audit scripts belonging to another workstream", "No rebase, no amend, no force-push"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
preset: backend
role: BACKEND
scope: ["state/ — the ledger rows", "the merge and commit commands around them"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: active
---

Finish the shipment by committing the project ledger the way this repository does it. The code and docs are already pushed as ce78641; state/ still holds 84 dirty rows (the journal, the view projections, the requirement and task mirrors). Run scripts/state-merge.mjs --check and quote the plan, run the merge so the script stages state/ itself, commit the ledger with a message naming the merge across machines, push, and prove the remote HEAD equals the local HEAD and that state/ is clean afterwards.
