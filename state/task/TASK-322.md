---
id: TASK-322
kind: task
title: "Commit the three-figure counter and the regenerated projections"
status: active
revision: 2
createdAt: 2026-11-26T09:55:49.102Z
updatedAt: 2026-11-26T09:55:51.310Z
acceptance:
  - text: "the counter change is one commit: project-state and state-feed sources, their tests, READMEs, versions and the two tarballs, staged by explicit path with a read-back showing nothing else"
    done: false
  - text: "the acceptance test move and the regenerated projections are in that same commit, quoted as paths"
    done: false
  - text: "the ledger goes in its own commit with a message saying whether a cross-machine merge existed"
    done: false
  - text: "both pushes leave remote main equal to local HEAD, proven by ls-remote against git rev-parse HEAD"
    done: false
  - text: "state/ has no dirty rows afterwards and the committed tree passes make test 69/69 and make verify"
    done: false
boardId: task-mwxdn7wg-0ada98
chore: true
choreReason: "The counter change (unclosed, active, agents), the acceptance test it moved, the regenerated projections and the ledger are uncommitted after a green gate."
nonScope: ["No product change beyond what is already in the tree", "No install, no kit-update, no restart", "No cleanup of .tools/ scripts from another workstream"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
preset: backend
role: BACKEND
scope: ["plugins/project-state and plugins/state-feed with their tarballs", tests/state-feed/state-notification.test.mjs, "state/ — the regenerated projections and the ledger rows", "the two commits and their pushes"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: active
---

Commit and push the counter change and the projections it required. One commit for the product: project-state gains the agents count in the snapshot projection, state-feed prints unclosed, active and agents, their tests, READMEs, versions and both tarballs, plus the acceptance test moved to the new contract — staged by explicit path with a read-back. One commit for state/ alone, which carries the regenerated projections and the ledger rows, following the repository's rule for that directory. Prove both pushes by comparing the remote main with local HEAD and leave the tree clean.
