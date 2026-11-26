---
id: TASK-318
kind: task
title: "Commit the guard fix, the independent test and the ledger"
status: active
revision: 2
createdAt: 2026-11-26T09:29:26.074Z
updatedAt: 2026-11-26T09:29:28.243Z
acceptance:
  - text: "every staged path is either the guard fix, the tester's test file, or the ledger; nothing else, quoted from git status before and the staged list"
    done: false
  - text: "two commits exist: one for the guard fix with both plugins and their tarballs, one for the new test file, and the ledger in its own commit with a message saying whether a merge existed"
    done: false
  - text: "the pushes leave remote main equal to local HEAD, proven by ls-remote against git rev-parse HEAD"
    done: false
  - text: "state/ has no dirty rows afterwards and nothing tracked is left unstaged except what another workstream owns"
    done: false
  - text: "make test and make verify are green on the committed tree"
    done: false
boardId: task-mwxcpayr-81jch4
chore: true
choreReason: "The proof-guard fix, the new independent test file and the ledger rows they produced are uncommitted; the tree must be clean before the owner installs and reloads the server."
nonScope: ["No product change beyond what already exists in the tree", "No install, no kit-update, no restart", "No cleanup of .tools/ scripts from another workstream"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
preset: backend
role: BACKEND
scope: ["plugins/proof-guard and plugins/taskboard with their tarballs", tests/state-feed/state-notification.test.mjs, "state/ — the ledger rows", "the three commits and their pushes"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: active
---

Commit and push the proof-guard fix, the independent test that found the defect, and the ledger. One commit for the guard fix (both plugins, their tests, versions and tarballs: proof-guard 0.1.10 and taskboard 0.1.86), one commit for the new test file tests/state-feed/state-notification.test.mjs, and one for state/ alone following the repository's ledger rule. Stage by explicit path with a read-back, prove each push by comparing the remote main with local HEAD, and leave the tree clean apart from the files another workstream owns.
