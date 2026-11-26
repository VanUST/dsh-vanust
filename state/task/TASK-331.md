---
id: TASK-331
kind: task
title: "Commit the retirement contour, the policy and the ledger"
status: done
revision: 6
createdAt: 2026-11-26T13:01:08.472Z
updatedAt: 2026-11-26T13:26:09.353Z
acceptance:
  - text: "three commits land: the retirement and counting contour, the policy and architect preset, and the ledger — each staged by explicit path with a read-back showing nothing stray"
    done: false
  - text: "each commit message names what the change gives a reader, in the project's terms, and the ledger message says whether a cross-machine merge existed"
    done: false
  - text: "remote main equals local HEAD after the pushes, proven by ls-remote against git rev-parse HEAD"
    done: false
  - text: "state/ has no dirty rows afterwards and no product file is dirty"
    done: false
  - text: "make test and make verify are green on the committed tree"
    done: false
boardId: task-mwxk9jmb-funsak
chore: true
choreReason: "Three finished workstreams and the ledger are uncommitted after green gates: the case retirement command, the TEST figure that counts live rows, and the policy plus architect preset change."
nonScope: ["No product change beyond what is already in the tree", "No install, no kit-update, no restart", "No cleanup of .tools/ scripts from another workstream"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["0537e15 'Retire a case from the shell and stop counting it as live work': 21 files, +563/-38, read-back 0 paths outside its set", "9c305a5 'Batch work into one seat, run independent tasks together, let the architect read the web': 8 files, +27/-14, read-back 0 stray paths", "53c6bca 'Record the project ledger as the running build wrote it': 14 state/ files, +310/-24; state-merge --check said no merge in progress", "ls-remote refs/heads/main = 53c6bcaa62368387f02cb1a60241b2227786b022 = git rev-parse HEAD", "state/ clean afterwards, no product file dirty, only the other workstream's two .tools probes untracked", "make test 70/70 and make verify 20/20 exit 0 on the committed tree"]
resultSummary: "Three commits pushed, remote main equal to local HEAD at 53c6bca: 0537e15 (21 files — the CLI retire command with its board update, the surface sweep, the live-row TEST figure, the terminal status through mirror and migration, tests, READMEs, versions 0.1.43/0.1.18, tarballs, the two retired case records and the case journal), 9c305a5 (8 files — the policy paragraphs, the architect preset's tool-web row and persona, the tool-families allow row, the proof and audit copies, the deployment rules, orchestrator 0.1.70) and 53c6bca (14 state/ files only). Each staged by explicit path with a read-back of zero stray paths; the ledger message states no cross-machine merge existed. After the pushes the tree holds only another workstream's two .tools probes, state/ is clean, and make test 70/70 and make verify 20/20 pass on the committed tree."
role: BACKEND
scope: ["plugins/test-cases, plugins/project-state, plugins/orchestrator with their tarballs", "scripts/state-migrate.mjs, scripts/tool-families-proof.mjs, scripts/audit-preset-composition.mjs", "profile/cordis.patch.yml, rules/DEPLOYMENT.md", "docs/cases/ and state/", "the three commits and their pushes"]
---

Commit and push three finished workstreams. First commit: the case retirement contour — the CLI retire command with its board update, the audit surface sweep, the TEST figure that counts live rows with retired named beside it, the terminal status mapped through the mirror and the migration, their tests, READMEs, versions and tarballs, plus the two retired case records and the case journal. Second commit: the orchestrator policy paragraphs on batching and parallel work, and the architect preset's web tools with its persona, the tool-families allow row, the proof and audit copies, the deployment rules and the orchestrator tarball. Third commit: state/ alone, following the repository's rule for the ledger. Push all three, prove remote main equals local HEAD, and leave the tree clean.
