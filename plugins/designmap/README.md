# designmap: pages as drawings

The design map is one Excalidraw page per map, stored as a normal scene file:

```
designmap/pages/<slug>.excalidraw
  → the panel (Project state -> Map) edits it in the vendored Excalidraw editor
  → the agent edits it with four tools: map_list, map_read, map_edit, map_render
  → map_render renders the page with Excalidraw itself in a headless browser
```

The page file is the whole document. There is no model, view, overlay, annotation or
manifest behind it; a crowded or off-canvas page gets hints from `map_read`, never a
refusal. design-map v1 (semantic YAML, ELK layout, scene contract, the seven
`designmap_*` tools) was deleted in P3; there is no compatibility reader.

## Agent tools

| tool | what it does |
|---|---|
| `map_list` | list the pages under `designmap/pages/` with node/edge counts and mtime |
| `map_read` | read one page as a compact outline (default) or the exact scene JSON, with hints |
| `map_edit` | one op per call: node.add/move/resize/label, edge.add/label, element.delete, page.create/rename/delete, tidy |
| `map_render` | render one page to PNG and SVG with Excalidraw in a headless browser |

The four tools are registered for the `orchestrator` preset only (config `presets`
overrides it); the `/designmap` command is the panel's ungated human path and accepts
`pages | page | save | tidy-page | render-page`.

## Package layout

- `index.js` — the Cordis host plugin: the four tools and the command.
- `src/pages.mjs` — the page store (one scene file, read/write, empty page).
- `src/elements.mjs`, `src/outline.mjs`, `src/ops.mjs`, `src/tidy.mjs` — element
  builders, the outline reader, `map_edit` ops and the overlap-removing `tidy`.
- `src/excalidraw-render.mjs` — the headless Excalidraw renderer used by `map_render`.
- `src/page-tools.mjs`, `src/command.mjs` — the tool definitions and the command handler.
- `client/page-view.jsx` — the editor the Project state panel mounts as `PageEditor`;
  `client/host.js` is its adapter to the `/designmap` command; `client/frame.js` loads
  the vendored Excalidraw frame (`client.frame.js`).
- `dist/index.mjs` — the pre-bundled host half that the tarball ships (`main`).

## Commands

```bash
npm test                      # node --test test/*.test.mjs
node build-client.mjs         # rebuild client.js and dist/index.mjs
node build-client.mjs --host-only
```

The host half ships pre-bundled so the kit boot installs the tarball without touching the
npm registry. `bin/pages-demo.mjs` writes a demo page through the agent ops.
