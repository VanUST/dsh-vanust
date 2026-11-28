---
id: TASK-303
kind: task
title: "Pull the updated kit and verify it locally"
status: open
revision: 1
createdAt: 2026-11-28T08:10:50.323Z
updatedAt: 2026-11-28T08:10:50.323Z
boardId: task-mx04ryg7-60k5mi
chore: true
choreReason: "Operational update of the kit checkout requested by the owner (2026-11-28): pull the newer kit and verify it locally. No product requirement changes; the ledger merge is housekeeping."
inline: true
steps: ["Back up the local ledger and commit it so the merge sees both sides", "Pull origin/main and merge state/ with scripts/state-merge.mjs", "Resolve conflicts outside state/ and commit the merge", "Run make verify and make test on the updated tree", "Run the case library and report deployment drift"]
stepsDone: 1
---

Fast-forward this workspace onto origin/main while keeping both machines' project ledger, then prove the updated kit on this Windows host: run make verify, make test and make cases, and report what the live deployment would apply at its next start.
