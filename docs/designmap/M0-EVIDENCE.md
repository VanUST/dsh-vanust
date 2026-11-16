# M0 evidence — designmap-core

Product-run evidence for `plugins/designmap/`. Commands were run from
`/home/iustimov/dsh-kit/plugins/designmap` on node v24.20.0 with elkjs 0.12.1,
zod 4.6.7, yaml 2.9.1 (exact pins, `npm ls --depth=0` → `elkjs@0.12.1 yaml@2.9.1
zod@4.6.7`). The API facts this code relies on are in
[API-TESTS-CORE.md](API-TESTS-CORE.md); the scene contract it implements is
[SCENE-CONTRACT.md](SCENE-CONTRACT.md).

## 1. Test suite (plugin-local, `node --test`)

```text
$ npm test
ℹ tests 53
ℹ pass 53
ℹ fail 0
ℹ duration_ms 764.837926
[exit 0]
```

The 53 tests cover: determinism and scene key order, YAML strictness and canonical
emission, zod refusal paths, apply atomicity/idempotency, empty model, the 25-node
budget with `layout.done`, every lint rule at its severity, overlay GC, JSONL null-safety,
the bundle index, and view selection. Each file carries a `PROOF:` header naming the production path it
protects.

## 2. Acceptance harness (`node bin/acceptance.mjs`, exit 0)

```text
$ node bin/acceptance.mjs
"ok": true
```

### Two runs over the same fixture are byte-identical

```text
$ node bin/render.mjs /tmp/m0-demo v.context --write ; cp out/v.context.scene.json /tmp/m0-scene-1.json
run1 exit=0
$ node bin/render.mjs /tmp/m0-demo v.context --write ; cp out/v.context.scene.json /tmp/m0-scene-2.json
run2 exit=0
$ sha256sum /tmp/m0-scene-1.json /tmp/m0-scene-2.json
2c5fa9e8504900080e0ca3905d90f95e82e08c57c7ebb27d26a1a1d06b1fa280  /tmp/m0-scene-1.json
2c5fa9e8504900080e0ca3905d90f95e82e08c57c7ebb27d26a1a1d06b1fa280  /tmp/m0-scene-2.json
sceneHash1 sha256:2c5fa9e8504900080e0ca3905d90f95e82e08c57c7ebb27d26a1a1d06b1fa280
sceneHash2 sha256:2c5fa9e8504900080e0ca3905d90f95e82e08c57c7ebb27d26a1a1d06b1fa280
bytes 3314   layout {"ms":180.17,"nodes":5}   lint {"error":0,"warning":0,"info":0}   merge applied 1
```

The fixture has 5 nodes, 4 edges, 1 group (`grp.checkout`) and one overlay row
(`db.orders` moved to `620,36`). The scene bytes carry the documented key order
(`schemaVersion … edges`), sorted ids, rounded numbers, no timestamps and no `$H`.

### Geometry is refused by the schema with its exact path

```text
model: code=invalid_model   paths=[["nodes",1,"x"],["nodes",1,"y"],["nodes",1,"fill"]]
op   : code=invalid_ops     paths=[["ops",0,"value","x"],["ops",0,"value","y"],["ops",0,"value","fill"]]
```

### An invalid reference is refused as a whole and leaves the files unchanged

```text
$ node bin/render.mjs fixtures/invalid v.context        # exit 1
{"refusal":{"code":"dangling_edge","message":"model lint failed: an edge endpoint is not a node of the model",
 "details":{"findings":[{"rule":"dangling_edge","severity":"error","id":"e.api.orders.read",
 "from":"svc.checkout.api","to":"db.orders","missing":["db.orders"]}],"viewId":"v.context"}}}

apply (acceptance):
code=dangling_reference missing=ghost.node
hashesBefore {model: sha256:d67b22ea…, views: sha256:d0f12b96…}
hashesAfter  {model: sha256:d67b22ea…, views: sha256:d0f12b96…}   unchanged=true
```

### A missing model is a valid empty scene

```text
$ node bin/render.mjs fixtures/empty v.empty            # exit 0
{"viewId":"v.empty","sceneHash":"sha256:da0a970474fad83c70080a8a419b6de6b12f0fc58f2fb3500e64c08a235f7f3d",
 "bytes":245,"layout":{"ms":0.0012,"nodes":0},
 "lint":{"ok":true,"counts":{"error":0,"warning":0,"info":0}}}
scene.nodes []  scene.groups []  scene.edges []  canvas {x:0,y:0,width:0,height:0}
```

An unknown view id is `{"code":"unknown_view","details":{"available":["v.empty"]}}`,
never an empty scene.

### The seeded 25-node view is inside the budget and logs `layout.done`

Three runs of the same fixture in the acceptance harness:

```text
run 1: layoutMs 66.39  totalMs 68.94  layout.done {"event":"layout.done","ms":66.39,"nodes":25,"viewId":"v.flow"}
run 2: layoutMs 50.06  totalMs 51.37  layout.done {"event":"layout.done","ms":50.06,"nodes":25,"viewId":"v.flow"}
run 3: layoutMs 47.02  totalMs 48.26  layout.done {"event":"layout.done","ms":47.02,"nodes":25,"viewId":"v.flow"}
worstTotalMs 68.94  budget 1500
(repeated acceptance runs since: worstTotalMs 67.45 and 65.93 — the assertion is `<= 1500`,
not the exact millisecond count)
sceneHash sha256:e9e24b182986b3e438f46b72987e082e53b520309b1b0f4591a069f27aeeafda (identical in all three)
```

### Every lint rule fires at its stated severity

| §8 row | rule | expected | observed | render |
|---|---|---|---|---|
| duplicate id | `duplicate_id` | error | error | refused `duplicate_id` |
| dangling from/to | `dangling_edge` | error | error | refused `dangling_edge` |
| node/view points at a missing group | `dangling_group` | error | error | refused `dangling_reference` |
| edge without label | `edge_label_missing` | error | error | refused `missing_edge_label` |
| orphan node | `orphan_node` | error | error | refused `orphan_node` |
| > 25 nodes on a view | `view_too_large` | error | error | refused `view_too_large` |
| > 15 nodes on a view | `view_large` | warning | warning | rendered |
| label > 40 characters | `label_too_long` | warning | warning | rendered |
| node overlap after merge | `node_overlap` | warning | warning | rendered |
| stale against manifest | `stale_node` | warning | warning | rendered |
| colour outside the type palette | `colour_out_of_palette` | info | info | rendered |
| (contract) non-finite geometry | `non_finite_geometry` | error | error | scene lint |

The severities are the owner spec §8 table; the earlier M0 assumption was corrected in
the round below.

### Real overlays: bad rows are ignored, render still succeeds

```text
gcCodes ["unknown_node","negative_coordinate","non_finite_coordinate",
         "colour_out_of_palette","colour_out_of_palette","unknown_key"]
applied 3   extDPosition {"x":30,"y":30}
svcAXUnchanged true   dbBXUnchanged true   colours []   sceneHash sha256:609f9a2e…
canvas {x:-32,y:-32,width:636,height:146}
```

The negative x on `svc.a` and the NaN x on `db.b` are ignored per axis while their
valid y applies; the palette refusals keep both colours out of the scene bytes; the
canvas is recomputed around the merged position (`ext.d` at 30,30).

## 3. Deviation from the API spike report

None in API usage. Two implementation choices are worth naming:

- **All edges are attached at the ELK root** with `elk.hierarchyHandling=INCLUDE_CHILDREN`,
  including edges whose endpoints are inside a group. The spike laid one edge inside the
  group; both forms work, and one root-level form keeps the graph builder single-path.
  Root-level section coordinates are absolute, which the projection relies on.
- **Ports are per edge endpoint** (`<edgeId>.src` / `<edgeId>.tgt`, side chosen from the
  view direction), so every edge is a simple source→target pair as ELK layered requires;
  self-loops are skipped in ELK and drawn by a local fallback.
- **Overlay merge re-anchors incident edge endpoints.** SCENE-CONTRACT's `edges[].points`
  rule requires the first/last point to be the source/target boundary. Applying an
  overlay `x`/`y` after layout would otherwise leave a moved node's edge detached, so
  `reattachEdges` projects those endpoints onto the moved box and recomputes `labelAt`;
  bends and edges of unmoved nodes stay byte-identical. This is the reading the contract's
  field rule demands; if the orchestrator intends detached edges instead, it is one call
  to remove.

`org.eclipse.elk.position` is deliberately unused: the spike proved it is a fixed-layout
option and inert for layered layout.

## 3b. Correction round — owner §8 severities + `index.json`

Two corrections after the first M0 proof, both re-run end to end.

### Severities replaced with the owner §8 table

`src/lint.mjs` `LINT_RULES` now states the §8 severities; `fixtures/lint-cases.mjs`
carries the matching expectations. What changed from the M0 assumption:

| rule | before | after (§8) |
|---|---|---|
| `view_large` (> 15) | info | warning |
| `view_too_large` (> 25) | warning | error |
| `edge_label_missing` | warning | error |
| `orphan_node` | info | error |
| `stale_node` | info | warning |
| `colour_out_of_palette` | warning | info |

Consequence: a render with an unlabelled edge, an orphan node or a > 25-node view now
legitimately refuses, with a stable code (`missing_edge_label`, `orphan_node`,
`view_too_large`); a stale node or an out-of-palette colour still renders and is
reported. The acceptance harness re-ran all twelve rules — the "observed" column above
is that run. Scene bytes for the demo fixture are **unchanged**, which the harness now
asserts against the golden hash:

```text
sceneBytesUnchanged { golden: sha256:2c5fa9e8…, actual: sha256:2c5fa9e8…, equal: true }
```

### `out/index.json` added for the read-only panel

The panel can read files but cannot list a directory, so `renderAll({ workspace })`
renders every view, writes all scenes and then `out/index.json`
(`src/index-file.mjs`, `workspace.writeIndex`, `node bin/render.mjs <dir> --index`).
Rows are sorted by view id, paths are relative to the designmap directory, and there is
no timestamp — so the index itself is byte-identical between runs. Rendering happens
before any write: a refusal on one view leaves the directory untouched.

```text
$ node bin/render.mjs /tmp/m0-bundle --index      # exit 0, twice
$ sha256sum /tmp/m0-index-1.json /tmp/m0-index-2.json
12163a054556ef88a807cacada558d53571bf8dc81333332be469043f03b9000  /tmp/m0-index-1.json
12163a054556ef88a807cacada558d53571bf8dc81333332be469043f03b9000  /tmp/m0-index-2.json
$ sha256sum /tmp/m0-bundle/out/v.context.scene.json
2c5fa9e8504900080e0ca3905d90f95e82e08c57c7ebb27d26a1a1d06b1fa280  (unchanged golden)

$ cat /tmp/m0-bundle/out/index.json
{"schemaVersion":1,
 "views":[{"viewId":"v.checkout","title":"Checkout internals","level":"component","direction":"TB",
           "parent":"grp.checkout","scenePath":"out/v.checkout.scene.json",
           "sceneHash":"sha256:d49147fa…","bytes":1283},
          {"viewId":"v.context","title":"Checkout — context","level":"context","direction":"LR",
           "parent":null,"scenePath":"out/v.context.scene.json",
           "sceneHash":"sha256:2c5fa9e8…","bytes":3314}],
 "modelHash":"sha256:3d433c64…","viewsHash":"sha256:14727a71…","overlaysHash":"sha256:82f84567…"}
```

Row shape corrected on 2026-11-16 to the pinned `SCENE-CONTRACT.md` §"The view index":
`id` → `viewId` (one key name everywhere, as in the scene), `parent` added (the group a
view zooms into — the drill-down key), and the redundant `sceneFile` dropped. Sorting now
keys on `viewId`. Re-proved by the orchestrator in the package itself: `npm test` 53/53,
`bin/acceptance.mjs` `ok:true`, two `--index` runs byte-identical at `12163a05…`, and the
demo scene still `2c5fa9e8…`.

`test/index.test.mjs` proves the index rows against the scene files on disk, the input
hashes against the workspace files, determinism of both scenes and index, and the empty
workspace case (`views: []`, no missing-file error). The acceptance harness repeats the
hash check end to end.

### Post-M3 note (index shape)

A sibling M1 task changed the `out/index.json` row shape after this run, from
`{id, sceneFile, …}` to `{viewId, title, level, direction, parent, scenePath,
sceneHash, bytes}` (sorted by `viewId`). The numbers above stay as recorded; the index
hash under the M1 shape is `sha256:12163a05…` and the full suite is 79 tests
(53 M0 + 26 M3). Details: [M3-EVIDENCE.md](M3-EVIDENCE.md) §7.

## 4. Assumptions and gaps

- **The owner spec's §8 severity table is now supplied and implemented** (see the
  correction section); §4/§6 were not present as files, so the document shapes follow
  the initiative contract (`docs/analysis/designmap-redesign.json`, FR-1) and
  `SCENE-CONTRACT.md`.
- `stale_node` is exercised through the `staleNodeIds` render seam; manifest plumbing is
  M3 by scope.
- No packaging/inventory row was added for `plugins/designmap` (packaging is a later
  milestone; installing into the live profile is out of scope). `scripts/check-portability.mjs`
  passes `inventory:matches-disk` regardless, and its two failures
  (`no-raw-path-in-dynamic-import`, `no-url-pathname-as-path`) come from
  `scripts/designmap-render-spike/`, a sibling task's files, not from this package.
- Timing was measured on this machine under normal load; the 25-node worst case was
  68.94 ms total, far inside the 1500 ms budget.

## F1 fix round — edge endpoints on boundaries, labels out of node boxes

The M1 renderer exposed two geometry defects in the scene core produced. Both were
reproduced by a probe that rendered the real fixtures and measured the emitted scene
(not inferred from code):

```text
== demo v.context (pre-fix hash sha256:2c5fa9e8…) ==
e.api.db:            first(172,57.67) srcDist=8.00 span=false | last(620,55.8)  tgtDist=0.00  span=true
e.api.worker:        first(164,67)    srcDist=0.00 span=true  | last(204,67)     tgtDist=14.00 span=false
e.payments.stripe:   first(644.6,118) srcDist=8.00 span=false | last(692.6,118)  tgtDist=8.00  span=false
e.worker.payments:   first(416,75)    srcDist=8.00 span=false | last(485,118)    tgtDist=8.00  span=false
labels inside boxes: e.api.worker labelAt(135.9,49) in svc.checkout.api;
                     e.worker.payments labelAt(398.9,82) in svc.checkout.worker
perf25:              e.n00.n01 last 14 px short; labelAt(161.8,72.33) in svc.n00
```

Cause: the projection copied ELK's section points verbatim. ELK attaches to a port
centre (an 8 px `FIXED_SIDE` port sits outside the node) and stops one port width short
of the target port; the label anchor was the arc-length midpoint shifted up by 18 px,
which is inside a node for short edges.

Fix (`src/layout.mjs`, `src/render.mjs`, `src/lint.mjs`):

- `snapEdgeToBoxes` projects the first/last point from the node centre through the
  neighbouring point onto the rectangle perimeter, so the point is exactly on the
  boundary and on the side the edge leaves/enters.
- `placeLabelOutside` samples the polyline (~2 px), subtracts the node boxes inflated
  by 4 px, and anchors the label on the midpoint of the longest free run (preferring
  16 px above the line, then 4 px below, then the point itself).
- Labels are recomputed AFTER the overlay merge, against the final boxes, so an
  overlay-moved node re-anchors its incident edges and re-places their labels.
- When no free sample exists, the fallback emits the polyline midpoint itself and the
  new `label_over_node` lint rule reports it at **warning** severity (defensive rule
  beyond the §8 table, so a regression is visible instead of silent).

Intended output change: the demo scene hash moves from
`sha256:2c5fa9e8504900080e0ca3905d90f95e82e08c57c7ebb27d26a1a1d06b1fa280` (3314 B) to
**`sha256:3ec7cf040db5ee668a87e436a825249fa597e2757839c622c884e688f5207ec4` (3329 B)**.

### 3c. Shape-aware node widths (0.1.7)

A rendered `datastore` (ellipse) showed its label crossing the outline: the box was sized
as if a rectangle used its full width for text, but an ellipse uses only the inscribed
area. `nodeSize(label, type)` now multiplies the text width by 1.45 for an ellipse and 1.9
for a diamond, capped at 400 px. Intended scene change for the demo fixture:
`sha256:3ec7cf04…` (3329 B) -> **`sha256:1adea6ca8275ee7c1dfe8be5e6e81446ae010d8594bd8d6fa6250a66e0a5d83a`**.
Only edge geometry changed; nodes, groups, canvas recomputation and all other bytes are
untouched by the fix. The old hash stays recorded above as the pre-fix value; the
golden is updated in `test/geometry.test.mjs` and `bin/acceptance.mjs`.

Post-fix measurements (`test/geometry.test.mjs`, all edges of both fixtures):

```text
demo edges checked:   e.api.db, e.api.worker, e.payments.stripe, e.worker.payments
perf25 edges checked: 26
every first/last point: distance to boundary 0.00, span=true
label anchors: 0 inside a node box (demo, perf25, and demo with svc.checkout.api
               overlaid at 600,300 where both incident edges and labels are recomputed)
label_over_node: seeded overlapping-box case renders with the warning and the fallback
                 anchor on the box boundary
determinism: two runs byte-identical, golden hash as above
```

Performance: the 25-node fixture still lays out, merges and lints inside the budget —
worst total **265.81 ms** on a cold run (63.30/43.26 ms on the next two), acceptance
harness worst 90.53 ms, all ≤ 1500 ms, `layout.done {nodes:25}` logged.

Suite state at the fix: all core tests 60/60 and all M3 host tests 26/26 pass. The
concurrently-developed `test/host-overlay.test.mjs` (M3 overlay write path, not part of
F1) was red at the same moment because `src/host.mjs`'s new allow-list rejects the
command's own `op` key (`model_fields_forbidden`); that is outside F1's scope and is
reported to the orchestrator rather than patched here.
