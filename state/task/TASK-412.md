---
id: TASK-412
kind: task
title: "One renderer: Excalidraw's own export, custom SVG writer deleted"
status: done
revision: 5
createdAt: 2026-11-24T10:48:14.564Z
updatedAt: 2026-11-24T11:20:45.289Z
acceptance:
  - text: "src/page-svg.mjs is deleted and no module of ours turns elements into SVG or PNG any more"
    done: false
  - text: "map_render renders the page with the real Excalidraw bundle in headless Chromium and writes designmap/out/<page>.png and .svg, returning both paths, their sizes and the element count"
    done: false
  - text: "the returned PNG is a real image (dimensions and byte size quoted) and the SVG is what Excalidraw exported, not a hand-written approximation"
    done: false
  - text: "a missing browser refuses by name (renderer_unavailable) with the reason, and no other tool depends on it"
    done: false
  - text: "the panel's Render SVG button goes through the same one renderer"
    done: false
  - text: "suites and make verify are green, the plugin is repacked, and the tarball matches dist"
    done: false
boardId: task-mwukmy3k-7ek3d0
nonScope: ["No drag fix, no read-mode change, no v1 deletion, no analysis gate removal", "No change to page format, map_edit ops or map_read", "No new tool beyond the four"]
owner:
  kind: agent
  label: BACKEND
preset: backend
reqIds: [REQ-250]
resultArtifacts: [plugins/designmap/src/excalidraw-render.mjs, designmap/out/system.png]
resultEvidence: ["render-page system: kind success in 5291 ms, PNG 1000x700, 46504 B, elements 46, renderer excalidraw", "no-browser run: MapRefusal renderer_unavailable 'no Chromium binary in ~/.cache/ms-playwright (set DESIGNMAP_CHROMIUM)'", "grep renderSvg|page-svg over src, client, test: 0 hits after deletion", "suites 140/140 and 15/15, make verify exit 0 with 0 FAIL, tarball 0.1.32 == dist"]
resultSummary: "The custom SVG writer is gone: src/page-svg.mjs deleted and no module of ours turns elements into an image. map_render boots the same vendored Excalidraw bundle the panel ships in headless Chromium, posts the page's elements through the frame's own load message and captures Excalidraw's canvas: 46504 B PNG, 1000x700, 46 elements, renderer 'excalidraw'. Without a browser it refuses by name (renderer_unavailable) with the reason. The panel's control goes through the same one renderer. The SVG is absent by the owner's decision because the vendored bundle is a stripped build with no export API."
role: BACKEND
scope: ["plugins/designmap/src/ — delete page-svg.mjs, add the headless Excalidraw exporter, rewire map_render", "plugins/designmap/index.js, src/page-tools.mjs, tests", "plugins/designmap/client/page-view.jsx — the Render SVG button through the same renderer; client bundle rebuild", "package.json version, dist, tarball"]
---

Remove our custom renderer entirely and make the one renderer Excalidraw itself, as the owner decided. (1) Delete src/page-svg.mjs and every path that turns elements into an image by our own code. (2) Reimplement map_render as a real Excalidraw export: boot the vendored Excalidraw bundle in headless Chromium with the page's elements, call its own export, and write designmap/out/<page>.png and designmap/out/<page>.svg; return the paths, sizes and element count so the agent can read the PNG with read_image and a deck or doc can embed the SVG. (3) The panel's Render SVG button goes through the same one renderer, not a third. (4) Refuse by name (renderer_unavailable) when no browser is present, with the reason. Update the tests that asserted the old writer, rebuild, repack.
