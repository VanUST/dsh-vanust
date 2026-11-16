# HANDOFF — Design map, 2026-11-16 (readability + human editing shipped)

State: clean at the commit that adds the annotation layer (after `f94a98c` review
follow-ups, `c991543` header contrast, `6e7b54d` readability, `cabe859` analysis record).
Tarball `plugins/cc-dsh-designmap-0.1.15.tgz`, sha256
`6325d2f43afe657ef8e908d3b30235f265e266b8b56c330415152304a2812764`. The live `:3080`
profile still runs 0.1.12; 0.1.15 installs on the next `dsh web` boot through kit
convergence. Do not restart the server from a chat.

## Done and proven

1. **Readability at the cause** (`6e7b54d`). Core owned a label *anchor point* while the
   panel drew a *rectangle*: on the repo's own `v.context`, 5 of 9 labels sat inside node
   boxes and every check said clean. Now `edgeLabelSize` is the only metric, the size goes
   to ELK as an edge label (corridor reserved), the plate is placed on its edge against the
   final boxes, the scene carries `edges[].labelBox` + `labelLines`, `placementIssues`
   validates plates as rectangles and edge bodies as segments, and `render` retries
   1.45x/2x then refuses `label_collision` / `edge_through_node`.
   Proof: 118/118 tests; `node bin/acceptance.mjs` ok:true; `node bin/audit-scene.mjs
   /home/iustimov/dsh-kit/designmap` → 0/0/0; `--scene harness/scenes/m0/v.context.scene.json`
   → 4 `label_over_node`, exit 1 (red control).
2. **The panel draws it**: chips from `labelBox`/`labelLines`, host-theme canvas
   (Excalidraw theme stays LIGHT — dark inverts the canvas), legend bar with counts, real
   zoom + Fit + resize refit, view switcher, palette more saturated. The React Flow
   fallback now draws the same plate (`f94a98c`).
3. **Independent review** approved and its six findings were fixed in `f94a98c` (fallback
   plate, refusal code by first issue, dead `placeLabelOutside` metric deleted, self-loop
   refusal test, harness default `?set=repo`, audit `--write-set` no longer deletes `out/`).
4. **Header blank button** (`c991543`): `--dmv-accent-ink` derived from the resolved accent
   (light accent → dark ink), toggle says "Done editing" while active.
5. **Human visual editing** (`2e4360d`, 0.1.15):
   - edit mode rebuilds the frame so Excalidraw's native chrome appears (toolbar,
     properties, shapes, pen, text, eraser); read-only hides it; the rebuild re-sends the
     current viewport so the map does not jump;
   - node moves/colours stay overlays; **any hex colour is accepted** now (out-of-palette
     is an informational finding — the human picks from the canvas swatches);
   - everything else the human draws is the **annotation layer**
     `designmap/annotations.json`, written whole through `/designmap op:'annotate'`
     (host: type whitelist, finite geometry, ≤200 elements, strips customData/link,
     REFUSES `customData.designmap`, drops `containerId` into `dm:`);
   - annotations draw above the scene, locked in read-only, editable in edit mode;
     `render` and the SVG export never read the file.
   Proof in the browser on the repo map (harness): a text note, an outline highlight, a
   node recolour `#b2f2bb` and a node drag all wrote through the command and survived a
   reload — `docs/designmap/screenshots/dm-edit-native-toolbar.png`,
   `dm-edit-recolour.png`, `dm-edit-annotations.png`, `dm-note-persisted.png`,
   `dm-edits-after-reload.png`. Tests: `test/host-annotate.test.mjs` 4/4.
6. Analysis ledger: `docs/analysis/designmap-readability.json` (11/11) and
   `docs/analysis/designmap-human-edits.json` (5/5) are **completed** with task evidence.
   Both goals completed; all board tasks closed. Case:
   `docs/cases/design-map-readable-no-label-over-a-node-audit-can-fail.json`.

## What is left (small, in order)

1. **Install 0.1.15 into the live profile** — the only thing between the owner and the
   features. `dsh web` boot does it via kit convergence; a manual path is
   `stop dsh web` → `corepack pnpm@11.7.0 add` the tarballs in the profile →
   `KIT_UPDATE=0 ./start.sh`. The owner loses the chat on restart, so ask.
2. **`make verify`** after the colour-policy change (last full run was before it; the
   portability allowlist already covers the vendored frame/loader). Also re-run
   `node --test test/*.test.mjs` and `node bin/acceptance.mjs` — both green at handoff.
3. **Docs**: the plugin README and `docs/designmap/SCENE-CONTRACT.md` already document the
   annotation layer and the new colour rule. Root README/USERGUIDE name the plugin but not
   the version — check `make verify`'s count checks after any inventory edit.
4. **Optional follow-ups recorded as open questions**: annotations are not in the SVG
   export (`OQ-EXPORT`); a long feedback edge (the `HTTP + SSE` U) still frames the map;
   an overlay-moved node can put an edge body through another box (warning only); the
   vendored frame fetches Excalifont from a CDN, so offline the canvas uses a fallback font.

## Traps the next session would otherwise repeat

- **The vendored Excalidraw frame has no rebuildable source** (`client.frame.js`, 3.4 MB
  minified + an 8 KB bridge). Its bridge accepts `{source:'design-map-panel', type:'load',
  scene:{elements, appState}}`, answers `ready`/`loaded`/`change`, and projects only
  `viewBackgroundColor, gridSize, theme, scrollX, scrollY, zoom` — no `selectedElementIds`.
  The chrome CSS is fixed at document creation, which is why mode changes rebuild the
  iframe (cached bundle + current viewport).
- **Never set `theme:'dark'`** in the appState: Excalidraw inverts the whole canvas.
- elkjs 0.12.1: an edge label reserves corridor width only when it has `text`; its returned
  x/y is a label-band position, so core places the plate itself.
- Harness (the browser proof path):
  `M1_DESIGNMAP=/tmp/dm-annot-ws M1_PORT=4320 node harness/serve.mjs` then
  `?set=repo`; injected `:root{--dsw-alias-*}` + `data-theme` simulates the host theme.
  `DESIGNMAP` is the designmap dir itself, not its parent. The harness now supports
  `/plugins/@cc/dsh-designmap/<file>`, workspace reads for index/manifest/overlays/
  annotations, and `commands.execute` in every mode (needed for edit-mode proof).
- The pre-fix scenes `harness/scenes/{m0,fixture}` must keep failing the audit: they are
  the "the check can fail" control. `fixtures/readability` is the green fixture set.
