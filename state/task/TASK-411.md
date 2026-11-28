---
id: TASK-411
kind: task
title: "P2 proof in a browser: the page editor loads, saves and never writes in read mode"
status: done
revision: 19
createdAt: 2026-11-24T09:55:23.657Z
updatedAt: 2026-11-24T12:24:41.123Z
acceptance:
  - text: "Project state → Map opens with the page rendered in the Excalidraw frame, console clean, screenshotted"
    done: false
  - text: "the page switcher lists the pages the host returns; a page with content shows its boxes and arrows"
    done: false
  - text: "a drag in edit mode is saved, survives a reload, and the agent-side read reports the new coordinate"
    done: false
  - text: "read mode does not write: the page file's sha256 is unchanged after panning and clicking"
    done: false
  - text: "Tidy and Render SVG do something visible and the page still parses"
    done: false
  - text: "the proof states the two installed versions (designmap 0.1.29, project-state-panel 0.1.47), the server URL, and removes the second server afterwards"
    done: false
boardId: task-mwuiqz5q-edfec3
chore: true
choreReason: "Independent browser verification of the P2 panel (design-map v2), written and run by a preset that did not implement it. It changes no product file."
nonScope: ["No edits to the panel, the plugin, the page file or the profile; verification only", "No product decisions about the design; report and stop", "No install into the live :3080 profile and no kit-update"]
owner:
  kind: agent
  label: UX/UI
preset: ux
resultArtifacts: [reports/p2-proof/proof5.out, reports/p2-proof/proof5-msgs.out, reports/p2-proof/60-after-drag-0.1.36.png]
resultEvidence: ["message table on 0.1.36: load(read, 46 locked) → ready/loaded → load(edit, 46 unlocked) → ready/loaded (panel focuses the frame here) → change with db.model [190,288]; on 0.1.35 that last message did not exist", "DRAG dragBorder start [95,276] moved [100,40] file [190,288] status 'Saved 46 element(s)'; RELOAD file {x:190,y:288}", "READ-MODE sha0 == sha1 (f261f880...e58b) after pan and click", "TIDY 46 -> 46, missing [], parses true; RENDER 640x2288 PNG 122779 B", "second independent run (proof5-msgs.out): before [90,248] after [190,288] and the change payload carries [190,288]"]
resultSummary: "Independent browser proof on designmap 0.1.36 + project-state-panel 0.1.47: Project state → Design map paints the page, the switcher lists the host's page, the FIRST pointer drag of a loaded box moves it [90,248] → [190,288], the panel saves it and a reload reads the same coordinate back; the frame now emits the change message that was missing on 0.1.35. Read mode leaves the page file's sha256 unchanged; tidy keeps all 46 elements; Render PNG writes a 640x2288 PNG and says so. The only console line is the vendored Excalidraw 'unload' policy violation, six times, one per frame build."
role: UX/UI
---

Independently verify the P2 design-map panel in a real browser, against the 0.1.28 build, without touching :3080. Prove: (1) the panel opens a page from designmap/pages in the Excalidraw frame with no console error, screenshotted; (2) the page switcher lists the pages the host returns, and a page with content renders its boxes and arrows; (3) a drag in edit mode is saved — reload the panel and the box is where you left it, and the agent-side read (map_read or the page file) reports the same coordinate; (4) read mode writes nothing (the file's sha256 is identical after interacting); (5) Tidy and Render SVG do something visible and leave a page that still parses. State the build you ran against and clean up the second server.
