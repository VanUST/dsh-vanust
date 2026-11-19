---
id: TASK-148
kind: task
title: "Defer the panel retirement until the new one is installed"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.003Z
updatedAt: 2026-11-17T15:52:41.003Z
acceptance:
  - text: "profile/cordis.patch.yml mounts designmap without disabling design-map; the retirement override is written as a ready-to-apply snippet in a comment"
    done: false
  - text: "plugins/inventory.json keeps the old design-map row mounted:true with the superseded note, and the new designmap row mounted:false"
    done: false
  - text: "node scripts/check-documentation.mjs still passes"
    done: false
boardId: task-mwj73dju-ygsmgx
inline: true
nonScope: ["the designmap insert row and its inventory entry (keep them)", "plugin code, docs, packaging", "installing or restarting :3080"]
resultEvidence: ["profile/cordis.patch.yml: the `disabled: true` override is now a commented, ready-to-apply snippet; check-documentation passes (exit 0, 23 plugins, counts agree)", "plugins/inventory.json: design-map mounted:true with a note that retirement is ready but not applied; designmap mounted:false", "rationale: the new panel has never been installed in the real shell, so disabling the only proven panel before that would remove the working map on the next boot"]
resultSummary: "Deferred the old-panel retirement: both panels stay mounted for the first install, with the one-line retirement kept commented and documented for after the human accepts the new panel in :3080."
scope: ["profile/cordis.patch.yml (design-map override only)", "plugins/inventory.json (design-map row mounted flag + note)"]
---

Hold back the retirement half of M4's wiring. M4 applied `design-map disabled: true` to the kit template, which would remove the only panel proven inside the real client shell on the next boot, before the new panel has ever been installed. Keep both mounted for the first install; leave the one-line retirement ready (documented) for after the human confirms the new panel in :3080.

Migrated from .dsh/taskboard.json (task task-mwj73dju-ygsmgx, revision 3).
