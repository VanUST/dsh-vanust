---
id: TASK-332
kind: task
title: "Push what is uncommitted, ledger only"
status: done
revision: 5
createdAt: 2026-11-26T13:26:05.457Z
updatedAt: 2026-11-26T13:28:15.107Z
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
resultEvidence: ["git status showed 8 dirty paths, all under state/, and no product file", "commit 7090829: 8 state/ files, +63/-22, read-back 0 paths outside state/, message states no cross-machine merge", "push 53c6bca..7090829; ls-remote refs/heads/main = 7090829f745a122fa409d70ac4645d496fc5a476 = git rev-parse HEAD", "state/ clean afterwards; only the other workstream's .tools probes untracked; make verify 20/20 exit 0"]
resultSummary: "The tree held 8 dirty paths, all under state/ — the journal, one modified task row, one new task row and five projections — and no product file. They went into one ledger commit, 7090829, staged with `git add -- state/` and a read-back of zero paths outside state/, with the message stating that no cross-machine merge existed. Pushed 53c6bca..7090829; remote main equals local HEAD at 7090829; state/ is clean afterwards, the only untracked files are another workstream's two .tools probes, and make verify is 20/20."
role: BACKEND
scope: ["git status and the read-back of what is dirty", "state/ — the ledger commit if it is dirty, and its push"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Push whatever is actually uncommitted. Read the tree first and report it exactly, split into product files and state/ rows. The ledger almost certainly moved since 53c6bca because tasks were closed, so commit state/ alone with a message that says whether a cross-machine merge existed, push, and prove remote main equals local HEAD. If anything outside state/ is dirty, stop and report it with the file and the change instead of committing it; the last three commits carried everything else and a stray product edit now would be someone else's work in flight.
