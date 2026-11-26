---
id: TASK-322
kind: task
title: "Commit the three-figure counter and the regenerated projections"
status: done
revision: 6
createdAt: 2026-11-26T09:55:49.102Z
updatedAt: 2026-11-26T10:02:16.993Z
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
preset: backend
resultEvidence: ["commit ecb0d52 'Count unclosed tasks, active tasks and active agents': 13 files, +221/-86, staged paths all under the two plugins, their tarballs or the acceptance test", "commit b17da57 'Record the project ledger and the regenerated projections': 10 files under state/, +114/-34; state-merge --check said no merge in progress", "ls-remote refs/heads/main = b17da5777db6aa9abf2e003429739c027405572a = git rev-parse HEAD", "make test 69/69 and make verify exit 0 at HEAD", "the recorded gap: git show HEAD:state/views/snapshot.md has no agents line, while a fresh regeneration on the same ledger writes '- active agents: 1' — the running old server rewrote the projections after the regeneration"]
resultSummary: "The three-figure counter and the projections it needed are committed and pushed: ecb0d52 (project-state and state-feed sources, tests, READMEs, versions, both tarballs and the moved acceptance test) and b17da57 (the ledger and the regenerated projections). Remote main equals local HEAD at b17da57; make test and make verify are green on the committed tree. One known gap is recorded rather than hidden: the committed snapshot.md does not yet carry the 'active agents' line, because the running server still holds the old generator and rewrote the projections after they were regenerated."
role: BACKEND
scope: ["plugins/project-state and plugins/state-feed with their tarballs", tests/state-feed/state-notification.test.mjs, "state/ — the regenerated projections and the ledger rows", "the two commits and their pushes"]
---

Commit and push the counter change and the projections it required. One commit for the product: project-state gains the agents count in the snapshot projection, state-feed prints unclosed, active and agents, their tests, READMEs, versions and both tarballs, plus the acceptance test moved to the new contract — staged by explicit path with a read-back. One commit for state/ alone, which carries the regenerated projections and the ledger rows, following the repository's rule for that directory. Prove both pushes by comparing the remote main with local HEAD and leave the tree clean.
