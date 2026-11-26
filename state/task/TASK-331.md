---
id: TASK-331
kind: task
title: "Commit the retirement contour, the policy and the ledger"
status: active
revision: 2
createdAt: 2026-11-26T13:01:08.472Z
updatedAt: 2026-11-26T13:01:11.242Z
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
  sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
preset: backend
role: BACKEND
scope: ["plugins/test-cases, plugins/project-state, plugins/orchestrator with their tarballs", "scripts/state-migrate.mjs, scripts/tool-families-proof.mjs, scripts/audit-preset-composition.mjs", "profile/cordis.patch.yml, rules/DEPLOYMENT.md", "docs/cases/ and state/", "the three commits and their pushes"]
sessions:
  - sessionId: 37d8c5d9-e6fe-4b3f-a5a4-72efe0188264
    label: BACKEND
    role: BACKEND
    status: active
---

Commit and push three finished workstreams. First commit: the case retirement contour — the CLI retire command with its board update, the audit surface sweep, the TEST figure that counts live rows with retired named beside it, the terminal status mapped through the mirror and the migration, their tests, READMEs, versions and tarballs, plus the two retired case records and the case journal. Second commit: the orchestrator policy paragraphs on batching and parallel work, and the architect preset's web tools with its persona, the tool-families allow row, the proof and audit copies, the deployment rules and the orchestrator tarball. Third commit: state/ alone, following the repository's rule for the ledger. Push all three, prove remote main equals local HEAD, and leave the tree clean.
