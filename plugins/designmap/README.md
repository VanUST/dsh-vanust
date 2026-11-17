# designmap (M0 core + M3 host)

Node package behind the designmap v1 redesign. The core owns **semantics → geometry**,
and the M3 host plugin exposes that pipeline to agents and to the panel:

```
model.yaml + views.yaml + overlays.json
  → zod-strict validation
  → canonical sort by semantic id
  → ELK layered layout (groups, ports), with the label plates RESERVED as edge labels
  → overlay merge after layout, with GC
  → label plates placed against the final boxes, then validated as rectangles
  → lint
  → scene JSON (docs/designmap/SCENE-CONTRACT.md)
```

The **client renderer panel** (M1) and **edit mode** (M2) ship in this package as the
prebuilt `client.js` bundle (source `client/` is a build input, not a runtime file);
the host plugin (`index.js`), the manifest, the JSONL log and the SVG/PNG export are
M3/M4.

## Commands

```bash
npm install                     # elkjs 0.12.1, yaml 2.9.1, zod 4.6.7 (exact pins)
npm test                        # node --test test/*.test.mjs
node bin/acceptance.mjs         # the M0 acceptance, one JSON report, exit 1 on failure
node bin/render.mjs <designmapDir> [viewId] [--write] [--log]
node bin/render.mjs <designmapDir> --index   # every scene + out/index.json
node bin/acceptance.mjs         # M0 acceptance report
node bin/living-doc.mjs         # M3 loop on a throw-away git repo (status→scan→apply→render→lint→export)
node bin/audit-scene.mjs <designmapDir>          # visual-consistency audit, exit 1 on a collision
node bin/audit-scene.mjs --scene <scene.json>    # audit one scene file (negative control)
node bin/audit-scene.mjs fixtures/readability --write-set harness/scenes/readability
node bin/tool-contract.mjs      # tool names + schema refusals via the installed dsh-tools validator
```

Exit codes: `0` success, `1` structured refusal (`DesignmapRefusal` with `code` and
`details`), `2` internal failure.

## Documents

### `model.yaml`

```yaml
schemaVersion: 1
groups:
  - id: grp.checkout
    label: Checkout
nodes:
  - id: svc.checkout.api        # immutable semantic id
    type: service               # frontend | service | worker | datastore | queue | external
    label: Checkout API
    group: grp.checkout         # optional group id, null when ungrouped
    source: src/checkout/api.ts # repo-relative path or null
edges:
  - id: e.api.orders.read
    from: svc.checkout.api
    to: db.orders
    kind: data                  # sync | async | data
    label: SQL / reads
```

### `views.yaml`

```yaml
schemaVersion: 1
views:
  - id: v.context
    title: Checkout — context
    level: context              # context | container | component | flow
    direction: LR               # LR | TB
    include: []                 # node-id globs, '*' is the only wildcard; [] = all
    parent: null                # group id for a drill-down view
```

### `overlays.json`

```json
{ "$version": 1, "svc.checkout.api": { "x": 420, "y": 180, "fill": "#2563eb" } }
```

Read-only for this package: it validates and merges rows, it never writes them. When a
row moves a node, the incident edge endpoints are re-anchored to the moved box
(`reattachEdges`) so the scene's "first point = source boundary" rule still holds;
edges of unmoved nodes keep their layout geometry byte for byte. A row
with an unknown id, a negative or non-finite coordinate, an unknown key or a colour
outside `src/palette.mjs` is reported in `merge.gc` and ignored — overlays can never
make render fail (FR-4). Colours do not enter the scene bytes (the contract has no
colour field); they are returned in the render envelope (`merge.colours`) for the
renderer.

## Output bundle and `index.json`

`renderAll({ workspace })` renders every view, writes `out/<viewId>.scene.json` and
then `out/index.json`. The panel does **not** read these files: it asks the host command
for `op:'views'`, which re-renders every view WITH the stored overlays and returns the
same envelope shape (no `out/` write), so the arrows and label plates in the panel are the
core's, not a client-side merge. The index remains the artifact the agent's `render` and
`export` write and the shape other consumers (CLI, SVG) agree on:

```json
{
  "schemaVersion": 1,
  "views": [
    { "viewId": "v.context", "title": "Checkout — context", "level": "context",
      "direction": "LR", "parent": null, "scenePath": "out/v.context.scene.json",
      "sceneHash": "sha256:…", "bytes": 3314 }
  ],
  "modelHash": "sha256:…", "viewsHash": "sha256:…", "overlaysHash": "sha256:…"
}
```

Rows are sorted by view id (field names are the M1 contract: `viewId`, `parent`,
`scenePath`, `sceneHash`, `bytes`), paths are relative to the designmap directory, and
the index has no timestamp — two runs produce byte-identical index bytes. Rendering happens
before any write, so a refusal on one view leaves the bundle untouched.

## Host plugin (M3)

`index.js` is the Cordis plugin: `inject ['tools','commands']`, tools registered per
agent from `agent/created` and gated by `agentPreset` (default `['orchestrator']`; config
`{presets}` widens it), and one ungated `/designmap <json-op>` command for the panel.
`config.dir` (default `designmap`) and the session cwd decide the workspace.

| tool | kind | effect |
|---|---|---|
| `designmap_status` | read-only | manifest vs HEAD + source hashes: `stale`, `commitBehind`, `staleNodes[{id,source,reason}]`, warnings |
| `designmap_scan` | read-only | git changes since the manifest commit: proposed upsert/remove node ops, affected nodes, blocked deletions, unrepresented files |
| `designmap_apply` | writer | semantic ops → model/views + `manifest.json`; atomic, idempotent (`applied`/`skipped`) |
| `designmap_render` | writer | scenes + `out/index.json`, stale flags in the envelope |
| `designmap_lint` | read-only | findings per view; never writes scenes |
| `designmap_open` | read-only | resolves a node's `source` (repo-relative + absolute) or a structured refusal |
| `designmap_export` | writer | `out/<viewId>.svg` of the merged scene (overlay position + colour); optional `format:'png'` when an external converter exists |

`designmap_apply`'s parameter schema is a closed object: `x`/`y`/`fill`/`stroke` are not
declared properties, so the **tool schema** refuses them with the field named
(`"ops[0].value.x" is not a declared property`) before execute; the core zod schema
repeats the refusal with `["ops",0,"value","x"]` for direct callers.

`manifest.json`:

```json
{ "schemaVersion": 1, "rev": 31, "commit": "<HEAD>", "generatedAt": "…",
  "modelHash": "sha256:…",
  "sourceHashes": { "svc.checkout.api": "sha256:…", "db.orders": null } }
```

Written by apply only, and only when the semantic model, the commit or the source hashes
change (a no-op apply leaves it byte-identical). A node without `source` is absent; a
missing file hashes to null. `status` compares the manifest commit with HEAD
(`commitBehind`) and each node hash with the file on disk (`source_changed` /
`source_missing` / `not_in_manifest`). A missing manifest is `stale: true` with
`manifest_missing`, never an error.

`rev` is the design-map revision the Analysis Record references (`designRef.mapRev`). It is
a **monotonic counter of semantic model content**: it rises by one only when the canonical
model differs from the previous `modelHash`, so a repeated apply, a re-render, an overlay
move or a `views.yaml`-only edit does not move it. The retired `design.excalidraw` scene's
`designMap.rev` (30) seeds the first manifest, so the migration continues at 31 and records
written against rev 30 are not reported as drifted. `design.excalidraw` is read only for
that seed; nothing writes it back.

Logs: every tool/command call appends JSONL to `designmap/logs/events.jsonl` —
`tool.enter`, `tool.exit`, `model.diff`, `layout.done`, `merge.applied`, `merge.gc`,
`lint.result`, `render.done`, `overlay.write` (M2). The log writer is null-safe: NaN,
undefined and cycles become `null`/`"[circular]"`, and a failing sink cannot fail a tool.

`designmap_scan` derives proposals from paths only (no AST parsing, spec §11): a new
watched source file becomes `{kind:'node',action:'upsert'}` with an id from its path; a
deleted file proposes `remove_node` only when no edge references the node (otherwise it
is reported as `blocked: node_has_edges`); modified files list their nodes as
`affectedNodes`. Scan never invents edges — that semantic decision belongs to the agent
or human confirming the batch.

## Packaging, install and profile wiring (M4)

- **Package**: `@cc/dsh-designmap`, MIT, ESM (`"type": "module"`), entry `dist/index.mjs`
  (the Cordis plugin) with the library surface at `./core`. The tarball is built with
  `scripts/pack-plugin.mjs --dir plugins/designmap`, which bumps the patch version, writes
  exactly one `plugins/cc-dsh-designmap-<version>.tgz` and prints its sha256. Nothing is
  installed by the pack step.
- **Shipped files** (`files` in `package.json`): `dist/` (the bundled host half),
  `client.js` (prebuilt panel bundle), `README.md`. Not shipped: `src/`, `index.js`,
  `test/`, `fixtures/`, `bin/`, `harness/`, `build-client.mjs` — the source tree is
  development material; `dist/` is what the loader imports.
- **No runtime dependencies — the host half ships pre-bundled.** `node build-client.mjs`
  emits `dist/` with `zod`, `yaml` and `elkjs` **inlined** (one shared `chunk-*.mjs`
  between the four entries, so the ELK engine appears once), leaving only the two packages
  the harness gives every plugin (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, declared
  in `peerDependencies`) as bare imports. The panel bundle is self-contained the same way
  (`@xyflow/react` + React bundled, React is a shell external).
  This is load-bearing for the kit, not a size optimisation: `dsh web` converges the
  profile through `scripts/kit-update.mjs`, which reinstalls every plugin tarball with
  `pnpm add` whenever the installed set differs from the kit's. With the three packages
  declared as `dependencies`, that install talked to the npm registry — measured
  2026-11-16 at **1m22s** of `ECONNRESET` retries per boot, and when the retries ran out
  the install failed *after* `pnpm remove` had already dropped all 24 plugins, leaving the
  profile with no plugin set at all. Bundled, the same install finishes in **1.9s** from
  tarballs on disk with the registry pointed at a dead port. The optional PNG export
  deliberately has **no** dependency either: it uses an external converter (see below).
- **Profile row** (kit `profile/cordis.patch.yml`): a top-level `insert` of
  `id: designmap`, `name: '@cc/dsh-designmap'`, `config: {dir: designmap, presets:
  [orchestrator]}`. The row id is the function name, the client declaration is
  `dsh.client: {platform: web, immediately: true, inject: [...shell packages...]}`, and
  every injected package exists in the shipped `@deepseek-ai/dsh-web-app` bundle. The
  plugin contributes tools/commands only, so it belongs in the Host configuration, not
  in an agent preset.
- **Install / restart**: the tarball goes into the profile through the kit's install path
  (`dsh web` converges it at boot, or `node scripts/kit-update.mjs --apply`). Verified on
  the live web profile on 2026-11-16: the row activates with no failed entry, and the
  install needs no network because the host half is pre-bundled (see above).

### Read-only and edit split

| Layer | Reads | Writes |
|---|---|---|
| Panel (`client.js`) | `op:'views'` through the command (scenes rendered with overlays); annotations via `workspaceFiles` | **nothing directly**; every edit goes through the command |
| `/designmap` command (panel path, human) | host service | `overlays.json` for `op:'overlay'` (auto-placed); `model.yaml` + `manifest.json` for `op:'label'` (apply); `out/` for render/export |
| Agent tools (`designmap_*`) | model/views/overlays/scenes | `model.yaml` + `views.yaml` + `manifest.json` via `designmap_apply`; `out/` via render/export |
| Core (`src/*.mjs`) | files given to it | only when called through the host; the core never writes `overlays.json` |

The panel is untrusted input: the host overlay guard validates an allow-list
(`action,nodeId,viewId,row,x,y,fill,stroke`) and refuses model fields with
`model_fields_forbidden`. The command strips the transport key `op` before the domain
call, so only the listed fields can reach `overlays.json`.

### Optional PNG export

`designmap_export` and `/designmap {op:'export', format:'png'}` rasterise the same SVG
scene with, in order, `rsvg-convert`, ImageMagick `convert` or `magick` found on `PATH`
(override with `DESIGNMAP_PNG_CONVERTER`). Without a converter the call refuses with
`png_converter_missing` and the SVG still exists; no rasteriser ships in the package.
The SVG remains the canonical artifact and is always written first.

### Vision loop — explicitly not shipped

The "render → screenshot → feed the image back to the model" loop is **not implemented
and has no switch** in this package. Reasons, so the decision is auditable: (1) the
M0–M3 contract has no tool result that carries an image and no owner-specified
contract for what the loop would do with one; (2) it needs a model-facing image
transport (session content block, size budget, redaction of workspace pixels) that
this milestone did not verify; (3) the panel already renders the scene faithfully and
the agent proves geometry from the scene JSON + lint, which is cheaper and
deterministic. Adding it later is a new tool with its own API spike, not a hidden
default.

### Retirement of the 0.2.0 Excalidraw panel

The old `@cc/dsh-design-map` (0.2.0, `design.excalidraw`) is superseded, not deleted:
its source, tarball and inventory row stay in the kit for rollback, `mounted` becomes
false, and the kit patch disables its loader row with an id-targeted override
(`disabled: true`) while inserting `designmap`. After the human restarts, the sidebar
shows only the new panel; `design.excalidraw` remains readable in Files but no tool
writes it. Rollback is one line: drop the `disabled` override and restart. Do not
delete `plugins/design-map/` without an explicit owner decision (M4 non-scope).

## Guarantees and how they are kept

| Requirement | Mechanism |
|---|---|
| INV-IDEMPOTENT | ELK output is projected to documented fields only (`$H` dropped), every number rounded to 2 decimals, all collections sorted by id, no timestamps/paths in the scene |
| INV-NO-GEO | every model/op object is a `z.strictObject`; `x`/`y`/`fill` is refused with `["nodes",N,"x"]` / `["ops",N,"value","x"]` |
| INV-EMPTY | a missing `model.yaml` is the empty document; an empty view yields `nodes: []` and a zero canvas |
| NFR-2 | apply validates the whole next document (including references) before writing; a refusal writes nothing |
| FR-4 | overlay GC warnings, never a render failure |
| INV-LABEL | every plate is a rectangle in the scene (`edges[].labelBox`); `placementIssues` tests it against node boxes and other plates with a 2 px gap, and the layout refuses `label_collision` when no free spot exists |
| INV-EDGE | every edge segment is clipped against every node box interior; a body through a node refuses `edge_through_node` at layout time and warns in the scene lint |
| FR-9 | `src/log.mjs` emits `tool.enter/exit`, `model.diff`, `layout.done`, `merge.applied/gc`, `lint.result`, `render.done`, `overlay.write`; null-safe serialization |

`layout.done` carries `{ms, nodes}`. `render.done` carries `{viewId, nodes, edges,
groups, bytes, sceneHash, ms}`.

## Lint rules and severities

Rule names are FR-6's; the severities are the owner spec **§8** table (authoritative),
mapped to rule ids in `src/lint.mjs`:

| §8 row | rule id | severity |
|---|---|---|
| > 15 nodes on a view | `view_large` | warning |
| > 25 nodes on a view | `view_too_large` | error |
| edge without label | `edge_label_missing` | error |
| orphan node | `orphan_node` | error |
| dangling from/to | `dangling_edge` | error |
| duplicate id | `duplicate_id` | error |
| label > 40 characters | `label_too_long` | warning |
| node overlap after merge | `node_overlap` | warning |
| stale against manifest | `stale_node` | warning |
| colour outside the type palette | `colour_out_of_palette` | info |
| (scene contract) non-finite geometry | `non_finite_geometry` | error |
| edge label plate overlaps a node box | `label_over_node` | warning (layout refuses first) |
| two edge label plates overlap | `label_label_overlap` | warning (layout refuses first) |
| an edge body passes through a node box | `edge_through_node` | warning (layout refuses first) |

A `dangling_group` (node/view points at a missing group) is also an error: the model
cannot be addressed. Error findings make `render` refuse and carry the findings in
`error.details.findings` with a stable code; warnings and info render and are reported
in the render result. A single-node view has no orphan finding (the "no edge" rule is
meaningless for a one-node context view).

## Readability: label plates, theme, zoom and the audit

The map is read, not just parsed, so geometry is checked before a scene is written and
the panel draws what the check approved:

- **One owner per label.** `edgeLabelSize` in `src/text.mjs` is the only place a plate's
  size is computed; the scene carries `edges[].labelBox` and `edges[].labelLines`, and the
  Excalidraw adapter draws a plate of exactly that rectangle with a bound text inside.
  Before this, core placed an anchor and the client measured the text, so the validator
  saw a point while a rectangle was drawn: on the repository's own map 5 of 9 labels sat
  inside node boxes and every check reported clean.
- **Room is reserved, then validated.** Each edge label is handed to ELK as an edge label
  with its real size (elkjs 0.12.1 reserves corridor width for it; a label without
  `text` reserves the width but reports position 0,0 — that is why the text is passed).
  The plate is then placed on its edge against the final boxes, and a crowded view retries
  with 1.45x/2x spacing before `render` refuses `label_collision` / `edge_through_node`.
- **The panel looks native.** The canvas is a separate document, so the panel passes the
  host theme's surface/ink/line into it: `viewBackgroundColor` is the host surface and the
  Excalidraw theme stays LIGHT on purpose (its dark theme inverts the whole canvas with a
  CSS filter, turning the palette into its negative). Edge labels are chips on the panel
  surface, group bands are tinted and titled, and type is shape + palette + stroke style.
- **The chrome tells the truth.** The legend is a bar under the canvas (a wide map needs
  the width), with per-type and per-kind counts; the status line shows the real Excalidraw
  zoom; `Fit` re-frames the scene and the canvas re-frames itself when the panel resizes
  (an empty viewport is re-fitted, a panned one is left alone); a view switcher appears
  when the workspace has more than one root view.
- **The audit can fail.** `bin/audit-scene.mjs` renders a workspace and reports plate-node,
  plate-plate and edge-node collisions, plates outside the canvas, minimum clearance and
  node density, exiting 1 on any collision. `fixtures/readability` holds the dense (20
  nodes), cyclic and multiline scenes used for acceptance; the pre-fix harness scenes
  under `harness/scenes/m0` and `harness/scenes/fixture` are kept as a red control — the
  audit reports 4 and 3 labels over nodes on them.

## Verified external APIs

Every external call in this package is covered by `docs/designmap/API-TESTS-CORE.md`:

- elkjs 0.12.1: layered with `hierarchyHandling=INCLUDE_CHILDREN`, ports with
  `FIXED_SIDE`; raw result projection (drop `$H`); parent-relative child coordinates are
  offset explicitly; `org.eclipse.elk.position` is NOT used (fixed-layout only); an edge
  `labels[]` entry reserves corridor space but its returned `x/y` is a label-band position,
  not the drawn one (measured: labels without `text` come back at 0,0), so the plate is
  placed by core instead of trusting that position.
- zod 4.6.7: `z.strictObject` everywhere (a plain `z.object` would strip `x/y/fill`).
- yaml 2.9.1: emitter pinned (`lineWidth: 0`) so long labels are not folded; `|` block
  scalars are normalised on read.

## Human editing: native tools, annotations kept beside the model

The map is the agent's document, but the human can mark it up:

- **Edit mode** rebuilds the frame so Excalidraw's own tools appear (selection, colour,
  shapes, arrow/line, pen, text, eraser, library). Read-only hides the chrome again. That
  rebuild re-sends the CURRENT viewport, so the map does not jump.
- **Node moves and colours stay overlays.** A drag writes `{x,y}`, the native properties
  panel writes `{fill,stroke}` — the same `overlays.json` rows the panel always wrote.
  A move that lands on (or within 8 px of) another node is auto-placed into the nearest
  free cell by the host, which stores both axes and returns `adjusted` plus an
  `overlap_adjusted` finding the panel shows; Undo restores the previous row.
  Any hex colour is accepted now; a colour outside the type palette is an informational
  finding (`colour_out_of_palette`), not a refusal, because the human picks from the
  canvas tools. The palette stays the default. The legend is built from the scene and the
  rows, so it shows the actual colour of each type and marks a type whose nodes disagree
  with `mixed`.
- **Arrows are bound to their nodes.** `sceneToElements` gives each arrow
  `startBinding`/`endBinding` and lists it in the node's `boundElements`, so a drag moves
  the bound endpoint with the box (the bends stay). The editor's route is never stored:
  after the drop the panel asks the host for `op:'views'` again and the core's route,
  plate placement and lint replace it. A `change` that arrives right after a load is
  ignored for 600 ms, because it describes the pre-load canvas and would undo the fresh
  render (the undo/reset race).
- **Labels are renamed in the panel, not on the canvas.** A locked label still swallows a
  pointer-down, so an editable one would make the middle of every node undraggable; the
  `Labels` inspector lists the view's nodes and edges and writes `op:'label'`, which goes
  through `apply` (an empty edge label is refused as `missing_edge_label`) and re-renders
  the view.
- **Everything else the human draws is an annotation.** `client/excalidraw.js`
  `freeElements` takes every canvas element WITHOUT `customData.designmap`; the panel
  debounces 700 ms and writes the whole layer through `/designmap op:'annotate'` into
  `designmap/annotations.json` (`{schemaVersion:1, elements:[…]}`, sorted keys, draw
  order preserved). The host validates it (`src/host.mjs annotate`): element type in
  rectangle/ellipse/diamond/arrow/line/text/freedraw, finite geometry, at most 200
  elements, `customData`/`link` stripped, `customData.designmap` REFUSED (a drawing may
  never masquerade as scene geometry), `containerId` into a `dm:` element dropped.
  `render` never reads the file and `model.yaml` is byte-identical after a write.
- **Annotations are drawn above the scene**, locked in read-only and free in edit mode;
  a malformed file is ignored with a warning. They are not part of the SVG export (the
  export is the scene; a human note is a note on the map).
- New shapes start unfilled, so a highlight does not hide the map until the human picks
  a fill (and can lower opacity in the Excalidraw panel).

## Known limitations

- A long feedback edge (a back edge in the layered graph) is routed around the whole map;
  the repository's `HTTP + SSE` edge is the visible example. The route is valid, it just
  reads as a frame around the map. A feedback-edge policy is an open question.
- When a human drags a node in edit mode, the edge endpoints are re-anchored but the
  polyline is not re-routed, so a moved node can put an edge body through another box. The
  scene lint reports `edge_through_node` as a warning; the map stays openable.
- The Excalidraw frame's font (Excalifont) is fetched from a CDN by the vendored bundle;
  offline, the canvas falls back to a system font. The bridge itself reports `elements` +
  a projected `appState` without `selectedElementIds`, which is why recolouring goes
  through the native properties panel instead of the panel's own NodeInspector.

## Seams that stay open

- `merge.colours` — M2's renderer paints from this envelope value; the scene has no
  colour field by contract. The M3 SVG export uses the same map.
- A malformed `overlays.json` is tolerated by the workspace reader (empty overlays) but
  the warning is not yet forwarded to `merge.gc`.
- Overlay writes from the panel (`nodeMoved`/`colorChanged`) are implemented in M2 and
  covered by `test/host-overlay.test.mjs`; the guard and the transport/domain split are
  described above.
