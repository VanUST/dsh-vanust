---
id: TASK-143
kind: task
title: "Contract: pin designmap/out/index.json"
status: done
revision: 2
createdAt: 2026-11-17T15:52:40.917Z
updatedAt: 2026-11-17T15:52:40.917Z
acceptance:
  - text: "SCENE-CONTRACT.md pins index.json: top-level {schemaVersion, views[], modelHash, viewsHash, overlaysHash}, rows {viewId,title,level,direction,parent,scenePath,sceneHash,bytes} sorted by viewId, no timestamps"
    done: false
  - text: "The document states the drill-down rule: clicking group X on a view opens the view whose parent is X"
    done: false
  - text: "M1 and M3 can read it without asking a design question"
    done: false
boardId: task-mwj5gjiq-y7vyq7
inline: true
nonScope: ["core code (BACKEND aligns the implementation to the document)", "the scene JSON section of the contract"]
resultEvidence: ["docs/designmap/SCENE-CONTRACT.md gained a 'The view index' section: schemaVersion/views[]/modelHash/viewsHash/overlaysHash, rows {viewId,title,level,direction,parent,scenePath,sceneHash,bytes} sorted by viewId, no timestamps", "Drill-down rule pinned: clicking group X opens the view whose parent is X; no affordance when none matches; missing index falls back to the fixture view set; unknown schemaVersion refused visibly"]
resultSummary: "Pinned designmap/out/index.json as the only view-discovery path for a panel that cannot list a directory, and fixed the drill-down semantics (parent is a group id; the child view is the one whose parent equals the clicked group). Core's current rows use `id`, omit `parent` and carry a redundant `sceneFile`, so M0 is being aligned to the document."
scope: ["docs/designmap/SCENE-CONTRACT.md (index section only)"]
---

Pin the view-index artifact (designmap/out/index.json) in the scene contract, because the panel reads files through a read-only workspace API and cannot enumerate a directory. The index is how M1 discovers views and how drill-down maps a clicked group to the child view.

Migrated from .dsh/taskboard.json (task task-mwj5gjiq-y7vyq7, revision 4).
