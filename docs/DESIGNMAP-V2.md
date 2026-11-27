# Design map v2: pages as drawings

Status: **proposal, 2026-11-24**. Replaces the v1 living document (`model.yaml` + `views.yaml` +
`overlays.json` + `manifest.json`, seven tools, a scene contract). Decisions taken by the owner:
**no backward compatibility** (old maps may disappear), **the map is not project state**, **the page
file is the truth**, **only our own drawing is carried over**. This document changes nothing by
itself; the phases at the end are the build.

## 1. What the four requirements forbid

| requirement | forbids | requires |
|---|---|---|
| editable by agent **and** by user | an edit path one of them cannot use: a canvas the agent cannot address, or a schema the human must hand-write | one document, two editors: the agent through one tool, the human on the canvas, both writing the same file |
| readable by agent **and** by user, independently | a single representation that is good for one and tolerable for the other (raw scene JSON is unreadable to a person; a screenshot is unreadable to an agent) | a visual form for the eye and a compact textual form for the model, both derived from the same document |
| several pages | one global graph where "page" is a filter over a shared node set | independent drawings, each a file; adding a page is adding a file |
| a visual tool, not a project description | semantic node types, source paths, git commit tracking, staleness, a layout that refuses to draw | shapes, text, arrows, colours, positions; a page that always opens; hints instead of refusals |

## 2. The document

A page is one Excalidraw scene file: `designmap/pages/<slug>.excalidraw`. It is the only store.
There is no model, no view, no overlay, no manifest, and no vocabulary of ours to validate:

- **a node** is a rectangle, ellipse or diamond with a bound text inside it;
- **an edge** is an arrow with `startBinding`/`endBinding` to those shapes and an optional bound
  text as its label;
- **everything else** — a note, a highlight, a freehand mark — is an ordinary element in the same
  file. A human annotation is no longer a second-class layer.

The page list is the directory: one file, one page, the filename is the title. Nothing is required
to be present: an empty page is a valid page and the panel draws an empty canvas rather than
alerting. The element skeleton our builders emit is the one the shipped adapter already writes
(`plugins/designmap/client/excalidraw.js:75-104`: id, type, x/y/width/height, seed, version,
versionNonce, boundElements, roundness, `containerId` for the bound text, `startBinding`/
`endBinding` for arrows) — but without `customData.designmap`, which existed only to map an element
back to a semantic node id that no longer exists.

## 3. The agent surface

Five tools instead of seven, and only the verbs a role is actually granted are registered (at the
v2 cut seven v1 tools were registered and four were unreachable through the allow-lists —
`profile/cordis.patch.yml:493-495,531-533`; `map_lint` was added on 2026-11-27):

| tool | effect |
|---|---|
| `map_list` | pages with node/edge counts and last-modified time |
| `map_read` | the page as a compact outline (`- [box] Checkout API`, `- Checkout API -> Orders DB: reads`), a geometry table (`id x,y w x h`), the page bounds and the readability verdict, plus `format:'json'` for the exact scene |
| `map_lint` | the readability check: a score, a verdict and every finding with the ids it measured and a `repair` op (`node_overlap`, `label_overflow`, `edge_label_on_node`, `edge_crosses_node`, `edge_crossing`, `edge_too_close`, `edge_unbound`, `edge_without_label`, `node_without_label`, `isolated_node`, `duplicate_label`, `page_too_tall`, `off_canvas`); a low score never refuses a save |
| `map_edit` | one `op` union: `diagram` (nodes + edges + layout in one call), `layout`, `tidy`, `align`, `note.add`, `node.add`, `node.move`, `node.resize`, `node.label`, `node.style`, `edge.add`, `edge.label`, `element.delete`, `page.create`, `page.rename`, `page.delete` |
| `map_render` | the page as a PNG, produced by **Excalidraw's own canvas** in headless Chromium, framed to the page's bounds (not cropped to a viewport) and captured with the editor toolbar/menu hidden: `out/<page>.png`, returning the path, its size, the page bounds and the element count so the agent can look at it (`read_image`) |

**No SVG, by decision (owner, 2026-11-24).** The vendored bundle the panel ships is a stripped build
with no export API — its own dialog offers only `.excalidraw` JSON — so a true vector export would
mean adding `@excalidraw/excalidraw` and a bundling step for headless use. The agent reads the PNG;
when a deck or a doc needs a vector, that decision comes back with the real package.

There is **no renderer of ours**. The frame renders in the panel; the same Excalidraw bundle renders
headless for the tool, so the picture the agent reads is the picture the human sees — fonts, arrow
heads, roughness, bound-text wrapping included. Readability for the agent does not depend on any
rendering choice: the outline and the JSON come from the elements, and the image is a second,
independent view of the same file.

`map_edit` builds the elements itself, so the agent never writes seeds, versions or bindings: an op
names a label and a place, the tool emits a valid rectangle with a bound text, and an edge op emits
an arrow with real bindings. A missing target is refused by name (`unknown_page`, `unknown_node`,
`unknown_op`); a crowded page is **not** refused — `map_lint` names the defects and `layout`
reports what it could not resolve.

**Drawing a scheme (2026-11-27).** One node per call left the agent placing twenty shapes blind,
and the old default put a coordinate-less node under the page, so a scheme became one vertical
column (owner's screenshot: labels on boxes, a 239x1096 px page). `diagram` draws the whole scheme
in one call — nodes, edges, direction — and the layout sizes each box for its text, orders the
layers to reduce crossings and leaves a layer gap of at least the widest edge label plus 24 px,
because Excalidraw draws a bound arrow label at the arrow's middle (v0.18.1 `textElement.ts`).
`map_lint` is advisory by design: it measures and proposes, it never refuses. The layout also
respects Excalidraw's inscribed text area — a rectangle offers `width − 10`, an ellipse
`width/2·√2 − 10`, a diamond `width/2 − 10` — because the editor grows a shape whose bound text
does not fit, which is how two boxes that were apart in the file overlapped on screen.

`tidy` is a deterministic layered placement (rank by edge direction, text-sized boxes, fixed gap)
in our own code. It no longer owns correctness: a page with boxes on top of each other opens, and
the hint list says so.

## 4. The human surface

There is **no standalone design-map panel**. The human opens the map where it already lives today:
**Project state → Map**. That mode stops being a read-only renderer of a server-computed scene and
becomes the page editor:

- the designmap client exports a `PageEditor` component; the state panel mounts it in `MapMode`
  instead of the old `SceneCanvas` (the same coupling direction the two plugins already have);
- the editor carries the page switcher (`designmap/pages/*.excalidraw`), `Check` (the readability
  report, with a Fix button for every finding whose repair is ready), `Tidy`, `Render` and
  `Full screen`; every button calls the same host operation the agent tool calls;
- drag, resize, text edit, colour and arrow creation are Excalidraw's own and are saved back into
  the page file with a debounced write;
- **the page is always editable** (2026-11-27): the read/edit toggle is gone, the frame is built
  in edit mode once, a scroll or a zoom does not write the file (only a different element list
  does), and the stage fills the panel body or the whole screen under `Full screen`.
- **the frame must own the focus before a drag.** An iframe document that was never focused lets
  Excalidraw select an injected element and never move it — the pointerdown selects, the move is
  ignored, and no `change` is emitted. Edit mode therefore focuses the frame when the page loads,
  so the first drag works instead of the second. Measured by bisect: a bare document without our
  CSS fails the same way, the ancestor chain has no transform, scale or zoom, and one click inside
  the frame flips the outcome.

The `main`-slot registration in `plugins/designmap/client/entry.jsx` is dead (the shell never
activates it) and is deleted. The overlays, annotations, label inspector and label-plate geometry go
with the scene contract: the text is in the shape, and the human edits it on the canvas.


## 5. What is deleted

| removed | reason |
|---|---|
| `model.yaml`, `views.yaml`, `overlays.json`, `annotations.json`, `manifest.json`, `out/*.scene.json` | replaced by the page file; nothing else reads them except the two couplings in §6 |
| node-type and edge-kind enums, `source` paths, groups as first-class objects | the rigid part: a drawing needs shapes and arrows, not a project ontology |
| `designmap_status`, `designmap_scan`, `designmap_lint`, `designmap_export`, `designmap_open` | staleness, git-diff proposals, the old refusing lint (its advisory successor is `map_lint`) and scene exports go with the model; `map_render` covers the export need |
| semantic ops with strict schemas (`designmap_apply`) | one loose `map_edit` union; an unknown field is ignored with a note instead of refused with a path |
| the retired scene contract, the 14 lint rules, label plates, ELK, the refusal codes | a page that refuses to draw is the failure the owner wants gone; hints replace refusals |
| our own SVG writer (`src/page-svg.mjs`) | a second renderer diverges from the canvas by definition; Excalidraw renders both the panel and the tool |
| `designmap/out/index.json` and the `views` command op | the page list is a directory listing |

## 6. The two couplings, and their new answer

1. **`plugins/analysis` reads `manifest.rev`** to capture `designRef` (`store.mjs:1228,1234-1248`)
   and to raise `design_drift` / `analysis_stale` (`store.mjs:1045-1048,1294-1295,1936-1937`). With
   the map decoupled from state that gate has no input: the drift check and the `designRef.mapRev`
   capture are removed, existing records keep the field as dead data, and no record is rewritten.
   The Analysis Record may still *name* a page in prose. This is the one behaviour the owner loses
   knowingly: the kit stops noticing that the drawing changed after a record was written.
2. **`plugins/project-state-panel` imports `SceneCanvas`** (`client.js:29-30`, used at
   `1706-1721`, declared as a client external in `package.json:35-37`) to show the map beside state
   rows with stale badges. It imports the **`PageEditor`** instead and mounts it in `MapMode`: the
   map keeps living where it lives today (the owner's choice, 2026-11-24), it just becomes editable,
   and the stale badges and scene contract go. `plugins/presentation` has no reference and is
   untouched.

The profile row keeps `id: designmap`, `name: @cc/dsh-designmap`, `config: {dir: designmap}`; the
preset allow-list keeps `orchestrator` and `architect`, and names only the five tools that exist.

## 7. Our own drawing

`designmap/model.yaml` holds eleven nodes and twelve edges. They are carried over once by a
throwaway importer (`bin/import-legacy.mjs`, deleted in the same change) that writes
`designmap/pages/system.excalidraw`; after that the old files leave the tree. This is a one-off, not
a supported path: no version check, no fallback reader, no migration tool.

## 8. Phases, each with its proof

**P1 — document and agent surface (no panel change).** Page format and element builders, outline
reader, `map_edit` ops, `tidy`, SVG render, the page tools registered by allow-list (four at the
v2 cut, `map_lint` added 2026-11-27), the one-shot importer and the page it produces.
*Proof:* create a page with four nodes and three edges through `map_edit`, read it back as an
outline that matches; `tidy` a tangled page and show boxes stop overlapping; render an SVG that
opens; `map_read` of a page with two overlapping boxes returns hints and no refusal.

**P2 — the editor inside Project state → Map.** The designmap client exports `PageEditor` (page
switcher, `tidy`/render buttons, debounced save; the read/edit toggle was removed on 2026-11-27
so the page is always editable); the state panel mounts it in
`MapMode` in place of `SceneCanvas`; the dead `main`-slot registration is removed; the overlay,
annotation and label paths are no longer called.
*Proof:* on a second server, open Project state → Map, the page renders in the frame with a clean
console; drag a node, reload, the position survives in the file and in `map_read`; a scroll or a
zoom leaves the file's sha256 unchanged, a drag changes it.

**P3 — retirement and couplings.** Delete the v1 files, tools, scene pipeline and docs; remove the
analysis drift gate and the `designRef` capture; switch the state panel to the SVG viewer; update
README, terminology («страница карты»), inventory and the preset rows.
*Proof:* `make verify` green; an analysis record still opens and no longer reports `design_drift`;
the state panel shows the page; `grep -r` finds no reader of `manifest.json`.

**P4 — proofs and packaging.** Repack `@cc/dsh-designmap` at the new major, install on a second
server, run the loop with a child agent and with a human drag, and quote both.
*Proof:* one child writes a page, a human moves a node, the agent reads the new coordinates; the
SVG renders; no console error; the kit gate is green.

## 9. Risks

- **The Excalidraw frame is heavy** (3.47 MB vendored, a CDN font, system fallback offline). It is
  already shipped and already the panel; keeping it costs nothing new, replacing it would cost an
  editor.
- **Geometry guarantees go away.** v1 refused a scene whose labels collided. v2 draws it and says so
  in hints; a page can look bad, and that is the accepted trade.
- **The translation layer is the new failure surface**: an op that emits an element Excalidraw cannot
  bind (a text without its container, an arrow to a missing id) renders wrong without throwing. The
  proof is a round-trip read, not the absence of errors.
- **One writer per page**: a human drag and an agent `map_edit` inside one debounce window is
  last-writer-wins. Named, not solved: the tool re-reads before writing, the panel reloads after its
  own save.
- **A record that relied on `design_drift`** stops being watched. That is the decision, not an
  oversight.

## 10. What we will not build

No migrator, no dual reader, no compatibility shims, no scene contract, no semantic node types, no
git-aware scanning, no refusal on a crowded page, no second store beside the page file, and **no
renderer of our own**: the panel frame and a headless run of the same Excalidraw bundle are the only
two renderers, and the image an agent looks at is Excalidraw's own export of the page.
