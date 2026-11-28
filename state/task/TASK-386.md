---
id: TASK-386
kind: task
title: "Pull the remote kit and verify the updated kit locally"
status: done
revision: 4
createdAt: 2026-11-23T08:24:00.596Z
updatedAt: 2026-11-23T08:24:17.826Z
acceptance:
  - text: "git status is clean and origin/main is fully merged"
    done: false
  - text: "make verify exits 0"
    done: false
  - text: "make test passes every step"
    done: false
  - text: "the pending deployment update is named"
    done: false
boardId: task-mwt01mym-yc0jlh
chore: true
choreReason: "an integration of remote commits plus two portability repairs found by the local verification; no open REQ describes them"
inline: true
resultEvidence: ["git log --oneline -5: fa35764, 14dd7dc, 72ac565 (merge), b44d1cf, 638cdb3; git status clean, behind=0", "make verify: VERIFY_EXIT=0 (check-portability tarball:matches-source and tarball:version-bumped PASS)", "make test: 87/87 passed (70 plugin test file(s), 17 proof script(s)) in 66833 ms, EXIT=0", "node --test plugins/proof-guard/test/write-scope.test.mjs: 7/8 red against the pre-fix module, 8/8 green after", "node scripts/independent-verification-proof.mjs: 29/29 checks held against bd7f9b6", "node scripts/kit-update.mjs --check --json: drift reason=kit-changed, plan install-plugins 6 + write-profile-files cordis.patch.yml + write-rules + patch-hindsight-tools; harness 0.2.2-rc.3 equals the pin"]
resultSummary: "Pulled origin/main (5 upstream commits: independent verification/TESTER, Hindsight supervision, Codex sign-in tools, dsh self-update, Windows fixes) into this workspace with a merge that keeps this workspace's own task ledger, then verified the updated kit on Linux. Two defects surfaced only on Linux and were fixed: the write-scope guard resolved Windows separators only for display (red 7/8 -> green 8/8, repacked as @cc/dsh-proof-guard 0.1.9), and the independent-verification proof read its red-first baseline from HEAD, which stops being pre-fix once committed (ERR_MODULE_NOT_FOUND; now 29/29 against bd7f9b6). Committed tree: make verify exit 0, make test 87/87. The live :3080 deployment is not converged: 6 plugin tarballs, the profile patch, the rules file and the Hindsight tools patch apply at the next start."
steps: ["Merge origin/main, keeping this workspace's ledger", "Run make verify and make test on Linux", "Fix the Linux-only defects the suite found and repack", "Re-run both gates on the committed tree and report the deployment drift"]
stepsDone: 4
---

Fast-forward this workspace onto origin/main (5 upstream commits), keep this workspace's task ledger, then prove the updated kit runs on Linux: the verify gate, the full test suite, and a drift report of what the live deployment will apply at its next start.
