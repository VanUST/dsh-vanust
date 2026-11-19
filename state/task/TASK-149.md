---
id: TASK-149
kind: task
title: "Commit and push the designmap 0.1.4 work"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.021Z
updatedAt: 2026-11-17T15:52:41.021Z
acceptance:
  - text: "designmap plugin + dist + 0.1.4 tarball, docs/designmap, analysis record, spikes and the profile/inventory/docs edits are committed in one feature commit"
    done: false
  - text: "The unrelated case-library staleness refresh and .reasonix metadata are committed separately as housekeeping"
    done: false
  - text: "Verification before commit: npm test green, check-documentation ok, tarball contents match package.json"
    done: false
  - text: "git push succeeds and the local branch is level with origin/main"
    done: false
boardId: task-mwj8n4q9-8wp5kv
inline: true
nonScope: ["changing code beyond what the working tree already contains", "installing or restarting the live :3080 profile", "force-push or rewriting published history"]
resultEvidence: ["git log: cd7b380 'Add @cc/dsh-designmap 0.1.4…' (160 files, designmap sources + dist + tarball + docs + spikes + kit wiring) and 2afd1f9 'Refresh case-library staleness…' (housekeeping)", "git push: eb05a30..2afd1f9 main -> main, git status -sb shows ## main...origin/main with no ahead/behind", "pre-commit verification: plugins/designmap npm test 94/94, node build-client.mjs exit 0 with dist byte-identical to the 0.1.4 tarball (10/10 files same sha256 incl. client.js), scripts/check-documentation.mjs ok", "temporary second server on :3099 used only for read-only inspection and stopped (curl 3099=000); the live :3080 was never restarted (3080=401 as before)"]
resultSummary: "Committed and pushed the designmap 0.1.4 work as two commits: the feature (plugin sources, self-contained dist bundle, 0.1.4 tarball, docs/designmap evidence, analysis record, API spikes, profile/inventory/README/USERGUIDE/DEPLOYMENT wiring) and a separate housekeeping commit for the case-library staleness refresh and desktop topic metadata. Pre-commit verification: 94/94 tests, rebuild byte-identical to the packed tarball, documentation check green."
scope: ["git index/commits on main", "designmap sources, dist, tarball, docs and kit wiring files that are already in the working tree"]
---

Commit and push the designmap 0.1.4 work (plugin with the self-contained dist host bundle, the boot fix, docs, evidence, spikes, profile/inventory wiring) plus the pending housekeeping changes, after re-verifying the package and doc gates locally.

Migrated from .dsh/taskboard.json (task task-mwj8n4q9-8wp5kv, revision 3).
