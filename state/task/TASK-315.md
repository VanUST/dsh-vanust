---
id: TASK-315
kind: task
title: "Commit and push the open-tasks block and the ledger"
status: active
revision: 2
createdAt: 2026-11-24T15:22:37.627Z
updatedAt: 2026-11-24T15:22:39.890Z
acceptance:
  - text: "every staged path belongs to the state-feed change or to the ledger; nothing else is included, quoted from git status before and the staged list"
    done: false
  - text: "the commit exists and names what changed for the product; the ledger rows are in their own commit with a message that says so"
    done: false
  - text: "the pushes leave the remote main equal to local HEAD, proven by ls-remote against git rev-parse HEAD"
    done: false
  - text: "state/ has no dirty rows afterwards and no tracked file is left unstaged"
    done: false
  - text: "the committed tree passes make test and make verify"
    done: false
boardId: task-mwuufspw-9gw3sy
chore: true
choreReason: "The open-tasks block in the state feed (0.1.7) and the ledger rows it produced are not committed yet; the tree must not be left dirty after the change the owner asked for."
nonScope: ["No product change beyond the state-feed files that already exist", "No cleanup of .tools/ scripts from another workstream", "No install, no kit-update, no restart"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
preset: backend
role: BACKEND
scope: ["plugins/state-feed and its tarball", "state/ — the ledger rows", "the two commits and their pushes"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: active
---

Commit and push the open-tasks block for the state feed together with the ledger it produced. One commit for the plugin change (plugins/state-feed sources, its test, README, version and the 0.1.7 tarball replacing 0.1.4), staged by explicit path; one commit for state/ alone, following the repository's ledger rule and saying in the message whether a cross-machine merge existed. Prove both pushes by comparing the remote main with local HEAD, and leave no tracked file unstaged and no state/ row dirty.
