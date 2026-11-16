# HANDOFF — Design map, 2026-11-16 (readability done, human editing next)

State: `git status` clean at `f94a98c` (after `6e7b54d` readability, `c991543` header contrast,
`cabe859` analysis record). The live `:3080` profile still runs `@cc/dsh-designmap 0.1.12`;
`0.1.14` (`plugins/cc-dsh-designmap-0.1.14.tgz`, sha256 `06efd1ae…`) installs on the next
`dsh web` boot through kit convergence. Do not restart the server from a chat.

## Done and proven

- **Unreadable map fixed at the cause** (`6e7b54d`). Core owned a label *anchor point* while
  the panel drew a *rectangle*: on the repo's own `v.context`, 5 of 9 labels sat inside node
  boxes and every check said clean. Now `edgeLabelSize` (`src/text.mjs`) is the only metric,
  the size goes to ELK as an edge label so the corridor widens, the plate is placed on its
  edge against the final boxes, the scene carries `edges[].labelBox` + `labelLines`, and
  `placementIssues` (`src/layout.mjs`) validates plates as rectangles and edge bodies as
  segments. `render` retries 1.45x/2x spacing then refuses `label_collision` /
  `edge_through_node`; the scene lint warns after a human overlay.
  Proof: `node --test test/*.test.mjs` → 112/112; `node bin/acceptance.mjs` → `ok:true`;
  `node bin/audit-scene.mjs /home/iustimov/dsh-kit/designmap` → 0/0/0;
  `node bin/audit-scene.mjs --scene harness/scenes/m0/v.context.scene.json` → 4
  `label_over_node`, exit 1 (the red control is the pre-fix tracked scene).
- **Panel draws it** (`6e7b54d`): label chips bound to `labelBox`, host-theme canvas
  (Excalidraw theme stays LIGHT — dark inverts the canvas), legend bar with counts, real
  canvas zoom + Fit + resize refit, view switcher. React Flow fallback also draws the plate
  now (`f94a98c`). Screenshots: `docs/designmap/screenshots/dm-*.png` (1280/1440, light/dark).
- **Independent review** (REVIEWER, task closed): APPROVE; its six findings are all in
  `f94a98c` (fallback plate, refusal code by first issue, dead `placeLabelOutside` metric
  deleted, self-loop refusal test, harness default `?set=repo`, audit `--write-set` no longer
  deletes the workspace `out/`).
- **Header blank button fixed** (`c991543`): `--dmv-accent-ink` derived from the resolved
  accent; the edit toggle now says "Done editing" while active.
- Analysis: `docs/analysis/designmap-readability.json` **completed**, 11/11 requirements
  proven with task evidence; case `docs/cases/design-map-readable-no-label-over-a-node-audit-can-fail.json`.
- Also done earlier in the chat: 63 stray root-level PNGs deleted (board task done).

## Left — the human editing layer (the owner's current ask)

The owner wants minimal visual editing for themselves: move/colour nodes, highlight areas,
text notes. Decision already recorded in `docs/analysis/designmap-human-edits.json` (rev 2,
**draft, not ready**): keep Excalidraw as the surface, expose its native tools in edit mode,
and persist everything the human creates in a **separate annotation layer**
`designmap/annotations.json` written through `/designmap op:'annotate'` — the model and the
scene never read it.

Task on the board: `task-mwjc553r-92wndj` (inline, open). Goal:
`goal-13893dad-f4ee-487c-ba80-d433336c8890` (active).

### Exact next step

1. Finish the analysis record before code: it needs `contracts` (new `CT-ANNOTATIONS`:
   `{schemaVersion, elements[]}` beside overlays; additive), `invariants` (no annotation
   element may carry `customData.designmap`; the model/scene never read the file),
   `decisions` (native chrome in edit mode vs a bespoke UI; separate file vs overlays),
   `trace` rows, then `analysis_check` → `status:"ready"`.
2. Host side first (fast, testable): `src/workspace.mjs` paths.annotations +
   `readAnnotations`/`writeAnnotations` (atomic, stable form); `src/host.mjs`
   `annotate(payload)` with the whitelist (element `type` in
   rectangle|ellipse|diamond|arrow|line|text|freedraw, finite x/y/w/h, `points` arrays for
   arrow/line/freedraw, ≤200 elements, strip `customData.designmap`, refuse model fields),
   log `annotate.write`; `src/command.mjs` `OPS` + `annotate` case + payload key `elements`.
   Tests: round-trip, forged designmap customData refused, >200 refused, model untouched.
3. Panel: `client/frame.js` `frameDocument(text, look, { editing })` must stop hiding
   `.App-toolbar/.App-menu` in edit mode; `client/canvas.jsx` caches the frame text and
   recreates the iframe when `editMode` changes, re-sending the CURRENT viewport (not a fit);
   merge `annotations` elements into `sceneToElements` (locked in read-only); extract
   elements without `customData.designmap` from each `change` event (debounce 500 ms) and
   call a new `onAnnotate`; `client/host.js` reads `designmap/annotations.json` in `load()`
   and writes it through `executeCommand`.
4. Prove in the harness (see below): recolour a node, add a text note, draw a highlight,
   reload → all three survive; screenshot. Then pack `0.1.15`, update README/SCENE-CONTRACT,
   record the owner case, commit, fill the analysis trace + complete the record.

## Traps the next session would otherwise repeat

- **The vendored Excalidraw frame has no rebuildable source** (`client.frame.js`, 3.4 MB,
  minified + an 8 KB bridge). The bridge listens for `{source:'design-map-panel', type:'load',
  scene:{elements, appState}}`, answers `ready`/`loaded`/`change`, and projects ONLY
  `viewBackgroundColor, gridSize, theme, scrollX, scrollY, zoom` from appState — no
  `selectedElementIds`. Do not try to patch the bundle; extend the panel side and use the
  `elements` the `change` event already carries.
- **Never set `theme:'dark'` in the Excalidraw appState**: it inverts the whole canvas with a
  CSS filter and turns the palette into its negative. Paint `viewBackgroundColor` = host
  surface and keep the theme light.
- elkjs 0.12.1: an edge `labels[]` entry reserves corridor width only when it carries
  `text`; without it the returned label position is `0,0`. Its returned x/y is a label-band
  position, not the drawn one — core places the plate itself.
- Harness (the browser proof path):
  `M1_DESIGNMAP=/home/iustimov/dsh-kit/designmap M1_PORT=4320 node harness/serve.mjs`
  then `http://127.0.0.1:4320/?set=repo` (or `?set=readability`). It maps
  `/plugins/@cc/dsh-designmap/<file>` to the package so the real frame loads; a dark theme is
  simulated by injecting `:root{--dsw-alias-*}` and setting `data-theme` on `<html>`.
- `bin/audit-scene.mjs --scene harness/scenes/m0/v.context.scene.json` must stay exit 1: it
  is the "the check can fail" control. The `fixture`/`m0` sets are pre-fix scenes on purpose.
- `make verify`: two vendored/generated files are allowlisted in
  `scripts/check-portability.mjs` (the frame bundle and the DSH loader copy) plus the two dev
  servers' `url.pathname`; keep those reasons honest if you touch them.
- Analysis gate: `task_close` is refused while a traced requirement is `planned`, and
  `delegate_task` (L1/L2) is refused while `docs/analysis/designmap-human-edits.json` is not
  `ready`. The `designRef` still points at the retired `design.excalidraw` rev 30 — that is
  the analysis service's design source for this workspace.
- Known residuals, recorded: a long feedback edge (the `HTTP + SSE` U) still frames the map;
  an overlay-moved node can put an edge body through another box (warning, not refusal); a
  recolour through the Excalidraw canvas was unreachable before this feature (that is why the
  native chrome is the plan).
