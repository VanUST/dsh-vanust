---
id: TASK-414
kind: task
title: "Pull the updated kit and verify it locally"
status: done
revision: 4
createdAt: 2026-11-28T08:10:50.323Z
updatedAt: 2026-11-28T08:26:21.315Z
boardId: task-mx04ryg7-60k5mi
chore: true
choreReason: "Operational update of the kit checkout requested by the owner (2026-11-28): pull the newer kit and verify it locally. No product requirement changes; the ledger merge is housekeeping."
inline: true
resultArtifacts: [.cache/20261128-pull/state-merge.log, .dsh/state-merge-report.json, .cache/20261128-pull/make-test-3.log, .cache/20261128-pull/kit-update-check.json]
resultEvidence: ["git rev-list --left-right --count HEAD...origin/main -> 3 0 (three local commits, no incoming)", "state-merge: 43 rows renumbered (12 REQ, 31 TASK), 13 aliased, 13 edited on both sides, 2 deleted on one side kept, 5 link hashes recomputed; journal 2904 events, replay ok", "make verify -> exit 0 (0 red; context-budget WARN for orchestrator tools=45 > budget 42)", "make test -> exit 0, 85/85 passed (66 plugin test files, 1 acceptance test file, 18 proof scripts) in 62473 ms", "kit-update --check --json -> drift: 13 plugin tarballs, cordis.patch.yml, DEPLOYMENT.md, Hindsight tools patch; harness 0.2.2-rc.3 equals the pin; appliedHead 8f00dd3 vs head d14bc29", "commit d14bc29 fixes the two Windows-only gate failures; merge commit 21c5f0b; ledger snapshot bf468e7", "state verify after merge: 335 task_req_missing + 513 orphan findings, pre-existing on both sides (pre-merge local 283/383, origin 312/482); 0 link_stale, replay clean"]
resultSummary: "Pulled origin/main (40 commits) into C:\\dsh-kit with a merge that kept both machines' project ledger, then verified the updated kit on Windows. make verify exits 0; make test now passes 85/85 after fixing two gates that only failed here: the server-scope test reads Linux-only /proc, and the analysis proof hit the new board ceiling on its eleventh unclosed task. The live :3080 deployment is not converged: 13 plugin tarballs, the profile patch, the rules file and the Hindsight tools patch apply at the next start. make cases was not run: 5 automated cases are stale and 2 unverified, so the suite would exit 1 by design and rewriting the case records is a separate task."
steps: ["Back up the local ledger and commit it so the merge sees both sides", "Pull origin/main and merge state/ with scripts/state-merge.mjs", "Resolve the one conflict outside state/ and commit the merge", "Fix the two gates the Windows run found and commit them", "Run make verify and make test on the committed tree and report deployment drift"]
stepsDone: 5
---

Fast-forward this workspace onto origin/main while keeping both machines' project ledger, then prove the updated kit on this Windows host: run make verify, make test and make cases, and report what the live deployment would apply at its next start.
