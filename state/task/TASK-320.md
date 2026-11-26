---
id: TASK-320
kind: task
title: "Commit the acceptance group in the gate and the ledger"
status: done
revision: 6
createdAt: 2026-11-26T09:37:04.140Z
updatedAt: 2026-11-26T09:50:20.994Z
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
preset: backend
resultEvidence: ["commit 4dc9232 'Run the acceptance tests inside make test': 3 files (scripts/test-all.mjs, Makefile, README.md), +60/-14", "commit 0623e6b 'Record the project ledger from this workspace': 10 files under state/, +111/-29; state-merge --check said no merge in progress", "ls-remote refs/heads/main = 0623e6b130cf371387b0115e9d01e4ed17bc5933 = git rev-parse HEAD", "make test 69/69 (50 plugin, 1 acceptance, 18 proof) and make verify exit 0 at HEAD", "state/ clean afterwards; only .tools/axe-labels.mjs and .tools/label-audit.mjs remain untracked"]
resultSummary: "The acceptance group in the gate and the ledger are committed and pushed: 4dc9232 'Run the acceptance tests inside make test' (scripts/test-all.mjs plus the two documentation lines) and 0623e6b 'Record the project ledger from this workspace' (10 files under state/). Both staged by explicit path with a read-back of zero paths outside the intended set; remote main equals local HEAD at 0623e6b, state/ is clean, and the committed tree passes make test 69/69 and make verify."
role: BACKEND
scope: ["scripts/test-all.mjs, Makefile, README.md", "state/ — the ledger rows", "the two commits and their pushes"]
---

Commit and push the acceptance group in the gate together with the ledger. One commit for the gate change — scripts/test-all.mjs plus the two documentation lines in Makefile and README that now describe the group — staged by explicit path; one commit for state/ alone following the repository's ledger rule. Prove both pushes by comparing the remote main with local HEAD, keep the tree clean apart from what another workstream owns, and quote make test and make verify on the committed tree.
