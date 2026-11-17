---
id: TASK-148
kind: task
title: "Defer the panel retirement until the new one is installed"
status: done
revision: 1
createdAt: 2026-11-17T15:52:41.003Z
updatedAt: 2026-11-17T15:52:41.003Z
boardId: task-mwj73dju-ygsmgx
---

Hold back the retirement half of M4's wiring. M4 applied `design-map disabled: true` to the kit template, which would remove the only panel proven inside the real client shell on the next boot, before the new panel has ever been installed. Keep both mounted for the first install; leave the one-line retirement ready (documented) for after the human confirms the new panel in :3080.

Migrated from .dsh/taskboard.json (task task-mwj73dju-ygsmgx, revision 3).
