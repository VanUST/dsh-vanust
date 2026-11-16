# designmap (M0 core + M3 host)

Node package behind the designmap v1 redesign. The core owns **semantics → geometry**,
and the M3 host plugin exposes that pipeline to agents and to the panel:

```
model.yaml + views.yaml + overlays.json
  → zod-strict validation
  → canonical sort by semantic id
  → ELK layered layout (groups, ports)
  → overlay merge after layout, with GC
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
then `out/index.json` — the panel reads files through a read-only workspace API and
cannot list a directory, so the index is its only discovery surface:

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
{ "schemaVersion": 1, "commit": "<HEAD>", "generatedAt": "…",
  "sourceHashes": { "svc.checkout.api": "sha256:…", "db.orders": null } }
```

Written by apply only, and only when `commit` or `sourceHashes` change (a no-op apply
leaves it byte-identical). A node without `source` is absent; a missing file hashes to
null. `status` compares the manifest commit with HEAD (`commitBehind`) and each node
hash with the file on disk (`source_changed` / `source_missing` / `not_in_manifest`).
A missing manifest is `stale: true` with `manifest_missing`, never an error.

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
| Panel (`client.js`) | `designmap/out/index.json` + scene JSON through the read-only workspaceFiles API | **nothing directly**; every edit goes through the command |
| `/designmap` command (panel path, human) | host service | `overlays.json` only for `op:'overlay'`; `out/` for render/export; `manifest.json` for apply |
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
| (defensive) edge label anchor on/inside a node box | `label_over_node` | warning |

A `dangling_group` (node/view points at a missing group) is also an error: the model
cannot be addressed. Error findings make `render` refuse and carry the findings in
`error.details.findings` with a stable code; warnings and info render and are reported
in the render result. A single-node view has no orphan finding (the "no edge" rule is
meaningless for a one-node context view).

## Verified external APIs

Every external call in this package is covered by `docs/designmap/API-TESTS-CORE.md`:

- elkjs 0.12.1: layered with `hierarchyHandling=INCLUDE_CHILDREN`, ports with
  `FIXED_SIDE`; raw result projection (drop `$H`); parent-relative child coordinates are
  offset explicitly; `org.eclipse.elk.position` is NOT used (fixed-layout only).
- zod 4.6.7: `z.strictObject` everywhere (a plain `z.object` would strip `x/y/fill`).
- yaml 2.9.1: emitter pinned (`lineWidth: 0`) so long labels are not folded; `|` block
  scalars are normalised on read.

## Seams that stay open

- `merge.colours` — M2's renderer paints from this envelope value; the scene has no
  colour field by contract. The M3 SVG export uses the same map.
- A malformed `overlays.json` is tolerated by the workspace reader (empty overlays) but
  the warning is not yet forwarded to `merge.gc`.
- Overlay writes from the panel (`nodeMoved`/`colorChanged`) are implemented in M2 and
  covered by `test/host-overlay.test.mjs`; the guard and the transport/domain split are
  described above.
