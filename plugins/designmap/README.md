# designmap: pages as drawings

The design map is one Excalidraw page per map, stored as a normal scene file:

```
designmap/pages/<slug>.excalidraw
  → the panel (Project state → Design map) edits it in the vendored Excalidraw editor,
    always editable, filling the panel body, with a Full screen control
  → the agent edits it with five tools: map_list, map_read, map_lint, map_edit, map_render
  → map_render renders the page with Excalidraw itself in a headless browser, clean
```

The page file is the whole document. There is no model, view, overlay, annotation or manifest
behind it; a crowded or off-canvas page gets findings from `map_lint`, never a refusal.
design-map v1 (semantic YAML, ELK layout, scene contract, the seven `designmap_*` tools) was
deleted in P3; there is no compatibility reader.

## Agent tools

| tool | what it does |
|---|---|
| `map_list` | list the pages under `designmap/pages/` with node/edge counts and mtime |
| `map_read` | read one page: outline, geometry table (`id x,y w x h`), page bounds and the readability verdict; `format: 'json'` for the exact scene |
| `map_lint` | the readability check: a score, a verdict and every finding with the ids it measured and a `repair` op |
| `map_edit` | one op per call: `diagram`, `layout`, `tidy`, `align`, `note.add`, `node.add/move/resize/label/style`, `edge.add/label`, `element.delete`, `page.create/rename/delete` |
| `map_render` | render one page to PNG and SVG with Excalidraw in a headless browser, framed to the page bounds, without the editor chrome |

The five tools are registered for the `orchestrator` and `architect` presets (config `presets`
overrides it); the `/designmap` command is the panel's ungated human path and accepts
`pages | page | save | tidy-page | render-page | lint | edit`.

## Drawing a scheme

`diagram` is the instrument for a whole scheme in one call: it builds every node and arrow,
resolves an edge endpoint by node id or label, and lays the page out with the edge labels in
the gaps:

```json
{"op":"diagram","page":"system","nodes":[{"label":"CLI"},{"label":"Orchestrator"},{"label":"Taskboard"}],
 "edges":[{"from":"CLI","to":"Orchestrator","label":"asks"},{"from":"Orchestrator","to":"Taskboard","label":"writes"}]}
```

`map_lint` then names what hurts: overlapping boxes, a label that does not fit the shape's
inscribed text area, an edge label sitting on a box, an arrow crossing a third box, crossing
arrows, boxes too close, an unbound or unlabeled arrow, an isolated node, a duplicate label, a
vertical page. Each finding carries the repair op, e.g. `{"op":"node.move","id":"n3","x":400,"y":40}`
or `{"op":"layout","direction":"LR"}`. A low score is a report; it never refuses a save.

The layout is deterministic: rank by edge direction, size every box for its text (a rectangle
offers `width - 10`, an ellipse `width/2·√2 - 10`, a diamond `width/2 - 10` — Excalidraw grows a
shape whose bound text does not fit), order each layer by a barycentre pass, and leave a layer
gap of at least the widest edge label plus 24 px, because Excalidraw draws an arrow label at the
arrow's middle (v0.18.1 `textElement.ts`).

## Package layout

- `index.js` — the Cordis host plugin: the five tools and the command.
- `src/pages.mjs` — the page store (one scene file, read/write, empty page).
- `src/elements.mjs` — element builders (shape + bound text, arrow + bound label, free note),
  colour names and the inscribed-area text metrics.
- `src/outline.mjs` — the outline reader, the geometry table and the hints.
- `src/lint.mjs` — the readability check: measured findings and their repairs.
- `src/tidy.mjs` — the deterministic layered layout (`layoutElements`, `tidyElements`).
- `src/ops.mjs` — the `map_edit` op interpreter (`diagram`, `layout`, …).
- `src/excalidraw-render.mjs` — the headless Excalidraw renderer used by `map_render`.
- `src/page-tools.mjs`, `src/command.mjs` — the tool definitions and the command handler.
- `client/page-view.jsx` — the always-editable editor the Project state panel mounts as
  `PageEditor`; `client/host.js` is its adapter to the `/designmap` command; `client/frame.js`
  loads the vendored Excalidraw frame (`client.frame.js`).
- `dist/index.mjs` — the pre-bundled host half that the tarball ships (`main`).

## Commands

```bash
npm test                      # node --test test/*.test.mjs
node build-client.mjs         # rebuild client.js and dist/index.mjs
node build-client.mjs --host-only
```

The host half ships pre-bundled so the kit boot installs the tarball without touching the
npm registry. `bin/pages-demo.mjs` writes a demo page through the agent ops.
