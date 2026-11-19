---
id: TASK-152
kind: task
title: "Client: themed Excalidraw canvas, label plates, legend bar, real zoom"
status: done
revision: 2
createdAt: 2026-11-17T15:52:41.075Z
updatedAt: 2026-11-17T15:52:41.075Z
boardId: task-mwjbs2x4-3r1bju
inline: true
nonScope: ["plugins/designmap/src/** (core task owns it)", "profile install / live :3080 restart"]
resultEvidence: ["screenshots: docs/designmap/screenshots/dm-1280-readonly.png (light 1280), dm-1280-dark.png (dark 1280), dm-context-1440.png, dm-context-1440-dark.png, dm-dense-1440.png, dm-dense-1280.png", "edge labels rendered as bound chips of edges[].labelBox; status zoom 0.71 matches the 1280 fit (was a stale 1.00)", "viewport refit on resize: dense view clipped at 1280 before the ResizeObserver, fully visible after", "node --test test/client-excalidraw.test.mjs -> 8/8"]
resultSummary: "The Excalidraw canvas now draws the scene the way the contract describes: edge labels are chips of exactly edges[].labelBox with a bound text (both themes), node type is shape+palette+stroke style (queue dotted, external dashed, datastore ellipse), group bands are tinted and titled, the canvas paints the host surface (Excalidraw theme stays light so its inversion filter does not turn the palette negative), the legend is a bottom bar with per-type/kind counts, the status line shows the real canvas zoom, Fit re-frames, the canvas re-fits on resize while untouched, and a view switcher appears for multi-view workspaces."
scope: ["plugins/designmap/client/**", "plugins/designmap/test/client-*.test.mjs", plugins/designmap/client.js, plugins/designmap/client.frame.js]
---

Make the panel draw the new scene well: edge labels as plates of the core labelBox with bound text, host-theme canvas (light and dark), type vocabulary (shape/fill/stroke per type), a bottom legend bar with counts, a real Excalidraw zoom plus Fit control, a view switcher, and group labels. Prove it in a real browser at 1280x720 and 1440x900 in both themes.

Migrated from .dsh/taskboard.json (task task-mwjbs2x4-3r1bju, revision 3).
