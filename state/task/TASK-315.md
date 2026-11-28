---
id: TASK-315
kind: task
title: "Commit and push the open-tasks block and the ledger"
status: done
revision: 6
createdAt: 2026-11-24T15:22:37.627Z
updatedAt: 2026-11-26T09:24:30.782Z
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
preset: backend
resultEvidence: ["commit 09b8323: 6 files, +242/-15, staged paths all under plugins/state-feed or the two tarballs; pushed 1d2c18d..09b8323 after three transport failures, landed on HTTP/1.1 with a larger post buffer", "commit bb915e1: 9 files, all under state/, +109/-23; state-merge --check said no merge in progress; replay 1774 events, 0 mismatches, 0 problems", "ls-remote refs/heads/main = bb915e1972460b5210c64b9ec0da111909da7760 = git rev-parse HEAD", "after: git status --porcelain -- state/ prints 0; only .tools/axe-labels.mjs and .tools/label-audit.mjs remain untracked", "make test 68/68 and make verify 20/20 on the committed tree"]
resultSummary: "The open-tasks block and the ledger it produced are committed and pushed as two commits: 09b8323 'Name the active and open tasks in the state message' (six files: the four state-feed sources, the new 0.1.7 tarball, the removed 0.1.4) and bb915e1 'Record the project ledger from this workspace' (nine files, all under state/). Both staged by explicit path with read-back showing nothing outside the plugin or state/. The ledger pass reported no cross-machine merge (no MERGE_HEAD, origin equal to HEAD) and its message says so; replay before commit 1774 events, 0 mismatches, 0 problems. Remote main equals local HEAD at bb915e1, state/ has no dirty rows, and the committed tree passes make test 68/68 and make verify 20/20."
role: BACKEND
scope: ["plugins/state-feed and its tarball", "state/ — the ledger rows", "the two commits and their pushes"]
---

Commit and push the open-tasks block for the state feed together with the ledger it produced. One commit for the plugin change (plugins/state-feed sources, its test, README, version and the 0.1.7 tarball replacing 0.1.4), staged by explicit path; one commit for state/ alone, following the repository's ledger rule and saying in the message whether a cross-machine merge existed. Prove both pushes by comparing the remote main with local HEAD, and leave no tracked file unstaged and no state/ row dirty.
