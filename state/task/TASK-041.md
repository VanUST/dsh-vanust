---
id: TASK-041
kind: task
title: "Audit the kit's plugins: defects, dead weight, and role fit"
status: cancelled
revision: 3
createdAt: 2026-11-17T15:52:39.455Z
updatedAt: 2026-11-17T15:52:39.455Z
acceptance:
  - text: "Every mounted row and every shipped plugin has a verdict with the file:line evidence"
    done: false
  - text: "Defects are reproducible (a command or a cited code path), not stylistic opinions"
    done: false
  - text: "The report names what to move into presets for role isolation"
    done: false
boardId: task-mwan6nq4-nbbuws
nonScope: ["changing code - this is an audit; fixes get their own task", "the uncommitted session-store change from another chat"]
owner:
  kind: agent
  label: REVIEWER
  sessionId: 1abe39dd-1c5d-40a9-964e-fbb5c15562b5
ownerRole: REVIEWER
role: REVIEWER
scope: ["plugins/*", profile/cordis.patch.yml, inventory.json]
sessions:
  - sessionId: 1abe39dd-1c5d-40a9-964e-fbb5c15562b5
    label: REVIEWER
    role: REVIEWER
    status: sleeping
---

Go through every plugin the kit ships and every row the profile mounts, and report which are broken, which do nothing useful, which duplicate the harness or each other, and which belong in a role preset rather than the host. Produce a ranked keep/fix/remove list with evidence from the code, not vibes.

Migrated from .dsh/taskboard.json (task task-mwan6nq4-nbbuws, revision 7).
