---
id: TASK-061
kind: task
title: "Case library: exploratory testing persisted as reproducible cases"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.698Z
updatedAt: 2026-11-17T15:52:39.698Z
acceptance:
  - text: "A plugin @cc/dsh-test-cases provides the library: case_record (title, requirement, kind regression|scenario, steps, fixture, expected, automated true|false, testPath+runCommand when automated, reason when not, tags, surface files), case_list/case_get, and case_verify (record a run: commit, date, passed/failed, evidence). The tool is the ONLY writer, so the schema cannot drift; files live in the repo (docs/cases/) and survive a session"
    done: false
  - text: "The workflow is enforced in the rules and personas: explore with the role's own tools FIRST, reproduce the case, THEN persist it; a case that can be automated stores its test path + exact run command, a case that cannot is stored with automated:false, its steps and a named reason - the requirement is never dropped"
    done: false
  - text: "Autotests are written only for cases that were observed (red first: break the code, the test fails; restore, it passes), and cases for behaviour that must keep working are recorded the same way. Quote the negative control"
    done: false
  - text: "Drift is detectable: a script/tool flags a case when its test file is missing or a recorded surface file changed since lastVerified, showing 'needs re-verification' without deleting the requirement; a case whose test is gone degrades to documented-only with the reason"
    done: false
  - text: "The deployment rule 'no autotests' becomes 'no speculative tests: explore and observe first, then persist the case'; ROOT_POLICY, CHILD_POLICY and the relevant skills say that"
    done: false
  - text: "Proof in a real project: create one automated case (real test, red/green), one documented-only case, run the drift check after touching a surface file and quote the flag; a real browser/tool session shows the critic producing a case from an exploration"
    done: false
  - text: "make verify green, versions bumped and packed, docs updated"
    done: false
boardId: task-mware39u-r8843h
nonScope: ["no test framework or runner vendor: cases point at the project's own runner (npm/pytest/cargo/playwright); the library is not a CI", "no automatic deletion or rewrite of existing tests or docs", "no changes to the sandbox/MCP/project-rules/design-map work", "no commits; no :3080 restart"]
scope: ["new plugin plugins/test-cases/ (host tools + schema + drift check), docs/cases/ as the library root", "profile/cordis.patch.yml row; access for critic/ux/backend/reviewer + read for the orchestrator", "ROOT_POLICY/CHILD_POLICY no-autotest rule; the proof-not-tests skill wording", README/USERGUIDE/DEPLOYMENT]
---

Turn every test performed by a role into durable, reproducible knowledge: a repo-tracked library of test cases where the agent explores and observes first, then persists the case - as an autotest when its actions are portable, or as a documented case with steps and expected outcome when they are not. The library keeps the business requirement even when its test drifts, flags cases that need re-verification, and proves each automated case red-first.

Migrated from .dsh/taskboard.json (task task-mware39u-r8843h, revision 4).
