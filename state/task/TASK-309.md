---
id: TASK-309
kind: task
title: "P4: installed 1.0.0 in the browser, no v1 names in the artefact"
status: done
revision: 4
createdAt: 2026-11-24T12:24:38.308Z
updatedAt: 2026-11-26T09:14:24.947Z
acceptance:
  - text: "the installed versions are quoted (designmap 1.0.0, project-state-panel 0.1.47, analysis 0.1.21) and the tarballs are the ones from plugins/"
    done: false
  - text: "boot console has no 'import failed' and no other new error; the known vendored Excalidraw 'unload' policy line is the only entry and is quoted"
    done: false
  - text: "Project state → Map paints designmap/pages/system.excalidraw from the installed build, the switcher lists it, and no 'does not export PageEditor' message appears"
    done: false
  - text: "the first pointer drag moves a box, the file's coordinates change, and a reload shows them"
    done: false
  - text: "the installed designmap bundle contains no designmap_apply/lint/status/scan/open/export names, quoted as a grep count"
    done: false
  - text: "the second server and the scratch home are removed and :3080 is untouched"
    done: false
boardId: task-mwuo2wt1-ti8aci
nonScope: ["No edits to plugins, profile or page files", "No install into the live :3080 and no kit-update", "No new browser feature work"]
owner:
  kind: agent
  label: UX/UI
  sessionId: eb7c1dc0-265d-4983-8475-5023d1cc19a3
preset: ux
reqIds: [REQ-246, REQ-247]
resultArtifacts: [reports/p4-proof/proof6.out, reports/p4-proof/installed-checks.txt, reports/p4-proof/50-map-read-mode.png]
resultEvidence: ["installed versions quoted from the copy: designmap 1.0.0, project-state-panel 0.1.47, analysis 0.1.21, from tarballs sha256 29930baf/ d7135f86/ 4e768449", "OPEN: switcher 'system — 11 node(s), 12 edge(s)', canvas 2, status designmap/pages/system.excalidraw", "DRAG: file [190,288] after the first pointer drag, status 'Saved 46 element(s)'; RELOAD reads {x:190,y:288}", "READ-MODE sha0 == sha1 (f261f880…); TIDY 46 -> 46, missing []; RENDER 640x2288 PNG 122779 B", "v1 tool names in the installed client.js and dist: designmap_status/scan/apply/lint/open/export/render all 0", "console: only 'Permissions policy violation: unload is not allowed in this document' ×6"]
resultSummary: "The installed 1.0.0 artefact works in a browser, not just from the tree: three tarballs extracted into a copy of the harness home, second server on :3081, Project state → Map paints the page (switcher 'system — 11 node(s), 12 edge(s)'), the first pointer drag moves a box [90,248] → [190,288] and saves it, and a reload reads the new coordinate back. Read mode leaves the page file's sha256 untouched; tidy keeps all 46 elements; Render PNG writes 640x2288. The installed bundle carries none of the seven v1 tool names."
role: UX/UI
sessions:
  - sessionId: eb7c1dc0-265d-4983-8475-5023d1cc19a3
    label: UX/UI
    role: UX/UI
    status: sleeping
---

Prove the retired-v1 build works as an installed artefact, not just from the tree: extract designmap 1.0.0, project-state-panel 0.1.47 and analysis 0.1.21 into a writable copy of the harness home, boot the second server on :3081 and show that Project state → Map paints the page and the first pointer drag moves and saves a box. Confirm the installed designmap bundle carries none of the seven v1 tool names, that the boot console has no activation error beyond the known vendored Excalidraw unload line, and that the state panel finds PageEditor. State all three installed versions, then remove the server and the copy.
