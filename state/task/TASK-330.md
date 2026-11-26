---
id: TASK-330
kind: task
title: "A retirement from the shell must update the board too"
status: done
revision: 7
createdAt: 2026-11-26T12:56:11.257Z
updatedAt: 2026-11-26T13:01:23.695Z
acceptance:
  - text: "retiring a case from the shell updates the board: after `cases deprecate`, the snapshot figure drops by one and the TEST row reads terminal, quoted before and after on a copy of the live state"
    done: false
  - text: "the CLI does not duplicate the mirror logic: it reaches the same store path the tool uses, or the reason a shared path is impossible is stated"
    done: false
  - text: "the CLI works in a workspace where the state service is not running, and says what it did in its output"
    done: false
  - text: "a retirement that cannot reach the state still leaves the case retired and reports that the board was not updated, instead of failing the retirement"
    done: false
  - text: "suites, make test and make verify are green and the plugin is repacked"
    done: false
boardId: task-mwxk37pn-nsm920
chore: true
choreReason: "The retire command now exists, but a retirement from the shell leaves the board unchanged because the CLI has no state service — the owner's exact scenario."
nonScope: ["No change to the retire verb or to the audit", "No change to what the TEST figure means", "No install, no commit, no push"]
owner:
  kind: agent
  label: BACKEND
preset: backend
resultEvidence: ["on a copy of the live state: - TEST: 88 before, `board: TEST-015 updated (deprecated)` with exit 0, then - TEST: 87 (1 retired) and TEST-015.md reads status: deprecated with caseId intact", "a workspace without a ledger: the case is retired and the command prints `board: not updated (no_state: ...)` with exit 0", "81/81 plugin tests, make test 70/70 and make verify 20/20 exit 0; test-cases repacked 0.1.43 and the tarball check passes", "the first pack 0.1.42 failed tarball:imports-resolve because of the literal sibling import; runtime resolution fixed it without weakening the check"]
resultSummary: "A retirement from the shell now updates the board: `cases deprecate` keeps its case write and adds a second half that calls the same mirrorCase the host tool uses, opening the workspace state core the way the merge script does, then regenerates the views. Proven on a copy of the live state: 88 before, `board: TEST-015 updated (deprecated)` with exit 0, 87 (1 retired) after, and the row reads deprecated with its caseId intact. When the ledger cannot be reached the case is still retired and the command says `board: not updated (no_state: ...)` instead of failing. No duplicated mirror logic: the CLI imports the function. test-cases 0.1.43 repacked; 81/81 plugin tests, make test 70/70, make verify 20/20."
role: BACKEND
scope: ["plugins/test-cases/bin/cases.mjs — the deprecate command", "plugins/test-cases/lib/store.mjs or mirror.mjs if the mirror entry needs a small seam", "tests for the CLI path, package.json version, tarball"]
---

Close the gap between the two retire paths. Today `case_deprecate` mirrors the case into the register, but `cases deprecate` from a shell writes the case and stops: the TEST row stays unverified and the snapshot figure does not move until some other case write happens to mirror it. Make the CLI mirror the retirement through the same path the tool uses — opening the workspace state core the way the merge script does — and keep the two behaviours honest: if the state cannot be reached, the case is still retired and the CLI says the board was not updated, rather than failing the retirement. Prove it on a copy of the live state: the figure drops by one and the TEST row reads terminal right after the shell command.
