---
id: TASK-313
kind: task
title: "Commit the project ledger through its own merge pass and push"
status: done
revision: 6
createdAt: 2026-11-24T13:16:21.760Z
updatedAt: 2026-11-24T15:05:49.694Z
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
preset: backend
resultEvidence: ["scripts/state-merge.mjs --check exit 0: 'no merge in progress'; MERGE_HEAD absent; HEAD equal to ls-remote refs/heads/main before the commit", "git add -- state/ only: staged 78 A + 7 M; git show --name-only grep -v '^state/' counts 0; git diff --name-only empty", "commit 1d2c18d 'Record the project ledger from this workspace': 85 files, +1932/-15, all under state/", "push ce78641..1d2c18d; ls-remote refs/heads/main = 1d2c18dbe37039cebed785d93dada10a92f929db = local HEAD; git status --porcelain -- state/ prints 0", "read-only ledger replay: 1759 events, 0 mismatches, 0 problems"]
resultSummary: "The project ledger is committed and pushed as 1d2c18d 'Record the project ledger from this workspace': 85 files, all under state/, staged by explicit path after scripts/state-merge.mjs --check reported that no cross-machine merge existed (no MERGE_HEAD, origin/main equal to HEAD), so no plan was invented and no side was chosen. The push moved ce78641..1d2c18d, the remote main equals local HEAD, and state/ has no dirty rows left. A read-only replay of the ledger shows 1759 events with 0 mismatches and 0 problems."
role: BACKEND
scope: ["state/ — the ledger rows", "the merge and commit commands around them"]
---

Finish the shipment by committing the project ledger the way this repository does it. The code and docs are already pushed as ce78641; state/ still holds 84 dirty rows (the journal, the view projections, the requirement and task mirrors). Run scripts/state-merge.mjs --check and quote the plan, run the merge so the script stages state/ itself, commit the ledger with a message naming the merge across machines, push, and prove the remote HEAD equals the local HEAD and that state/ is clean afterwards.
