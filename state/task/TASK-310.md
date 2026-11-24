---
id: TASK-310
kind: task
title: "Close the two remaining risks: the unload console line and the stale recorded case"
status: done
revision: 5
createdAt: 2026-11-24T12:40:09.381Z
updatedAt: 2026-11-24T12:52:42.477Z
acceptance:
  - text: "the 'Permissions policy violation: unload is not allowed' line is gone from a real browser boot, quoted as an empty console for that run"
    done: false
  - text: "the frame still works after the patch: the page paints and the first pointer drag still moves a box"
    done: false
  - text: "the patch is marker-checked: if the bundle text lacks the expected pattern the call refuses by name instead of silently doing nothing"
    done: false
  - text: "the recorded case design-map-revision-moves-with-the-model is retired through the library's own store with status superseded and a reason naming the v1 removal, not by hand-editing JSON"
    done: false
  - text: "the case list no longer reports it as active and case_drift does not flag it"
    done: false
  - text: "make test and make verify are green and the designmap plugin is repacked"
    done: false
boardId: task-mwuomv15-65aab5
chore: true
choreReason: "Closing the two residual risks of the design-map redesign before the commit: a console error the vendored Excalidraw bundle triggers inside our iframe, and a recorded case whose steps go through tools that no longer exist."
nonScope: ["No change to page format, the four tools or the editor's behaviour", "No new dependency", "No commit and no push in this task"]
owner:
  kind: agent
  label: BACKEND
  sessionId: 7cf1753d-2dfb-4743-9cf6-2182d95ea5e8
preset: backend
resultEvidence: ["browser, raw bundle: console shows 'Permissions policy violation: unload is not allowed in this document' with the canvas rendering; patched: console is empty, canvas 2, same drag result (db.model 90,248 -> 150,288)", "frameDocument on a marker-less text refuses with FrameBundleMismatch / FRAME_BUNDLE_MISMATCH naming the missing registration", "bundle-patch.test.mjs 4/4 including the marker-less refusal and that removeEventListener('beforeunload') is untouched", "case through the store: status superseded, revision 2, reason naming the v1 removal, steps and requirement kept, driftFor status null, absent from case_list status=unverified", "docs/cases/journal.ndjson carries the write entry from writeCase, not a hand edit", "make verify exit 0 (20/20), make test 68/68, designmap package 22/22, tarball 1.0.1 matches client.js and dist/index.mjs"]
resultSummary: "Both residual risks are closed. The console line is gone: the vendored bundle registers two document-lifetime handlers (the native unload registration in the App constructor and beforeunload), and both are stripped in memory by client/bundle-patch.js with a marker check that refuses by name (FrameBundleMismatch) when the bundle no longer matches. Proven in a browser under the shell's own condition: raw shows the violation with the canvas rendering, patched shows an empty console with the same canvas and the same first drag. The stale recorded case design-map-revision-moves-with-the-model is retired through the library's store as superseded with a reason naming the v1 removal, its steps and history kept, driftFor now returns status null and it no longer appears as unverified. make verify 20/20, make test 68/68, designmap repacked 1.0.1 and matching its sources."
role: BACKEND
scope: ["plugins/designmap/client/frame.js and the shared bundle-patch module", "plugins/designmap/src/excalidraw-render.mjs if the patch moves there", "plugins/test-cases — retiring the case through the store", "package.json version, dist, tarball"]
sessions:
  - sessionId: 7cf1753d-2dfb-4743-9cf6-2182d95ea5e8
    label: BACKEND
    role: BACKEND
    status: sleeping
---

Eliminate the two remaining risks of the design-map redesign. First, the vendored Excalidraw bundle registers a beforeunload listener that makes the browser print 'Permissions policy violation: unload is not allowed in this document' once per frame build; strip that registration in memory while the frame document is built, with the same marker check the renderer already uses for its export switch, so a re-vendored bundle refuses by name instead of silently losing the fix, and prove a real browser boot has no such line while the page still paints and the first drag still moves a box. Second, retire the recorded case design-map-revision-moves-with-the-model: its steps go through the deleted designmap_apply and manifest.json, so mark it superseded through the library's own store API with a reason naming the v1 removal, keeping its history, and show that the library no longer treats it as active. Repack and keep the gates green.
