# designmap scene contract, v1

The single integration artifact between `designmap-core` (layout, merge, lint) and the
client renderer panel. Core **produces** a scene; the renderer **draws** it and emits
events; nothing else crosses the boundary. This document is the orchestrator's
integration contract: M0 implements it and may propose a change, M1 consumes it and
cannot add a field to it.

Source of truth for the requirements: `docs/analysis/designmap-redesign.json`
(CT-SCENE, CT-OVERLAY, INV-NO-GEO, INV-IDEMPOTENT, INV-EMPTY, FR-7).
Owner of the document: the orchestrator. Owner of the producer: BACKEND (M0).
Consumer: UX/UI (M1).

## Coordinate system

- Origin top-left, `x` right, `y` down, unit = CSS pixel. This is ELK's own coordinate
  orientation, so layout output needs no flip. SVG and React Flow agree with it.
- All geometry is finite (`Number.isFinite`). A non-finite value is a lint error and
  `render` refuses with `non_finite_geometry` rather than emitting NaN into the scene.
- Numbers are rounded to 2 decimals before serialization, so float noise cannot break
  the byte-identical rule (INV-IDEMPOTENT).
- A view's canvas includes every node, group band and edge bend point with a 40 px
  margin on all four sides. `canvas.x/y` may be negative: it is the scene origin, and
  the renderer must not assume `0,0`.

## The scene file

Written by core to `designmap/out/<viewId>.scene.json`, UTF-8, two-space JSON,
keys in the documented order, **no timestamps and no absolute paths** — two runs over
the same `model.yaml` + `views.yaml` + `overlays.json` must produce byte-identical files.
`generatedAt`, commit and staleness live in the tool result envelope and in
`manifest.json`, never in the scene bytes.

```json
{
  "schemaVersion": 1,
  "viewId": "v.context",
  "title": "Checkout — context",
  "level": "context",
  "direction": "LR",
  "canvas": { "x": -40, "y": -40, "width": 960, "height": 520 },
  "nodes": [
    {
      "id": "svc.checkout.api",
      "type": "service",
      "label": "Checkout API",
      "group": "grp.checkout",
      "x": 240, "y": 120, "w": 160, "h": 44,
      "stale": false,
      "source": "src/checkout/api.ts"
    }
  ],
  "groups": [
    { "id": "grp.checkout", "label": "Checkout", "x": 200, "y": 80, "w": 320, "h": 200 }
  ],
  "edges": [
    {
      "id": "e.api.orders.read",
      "from": "svc.checkout.api",
      "to": "db.orders",
      "kind": "sync",
      "label": "SQL / reads",
      "points": [{ "x": 400, "y": 142 }, { "x": 520, "y": 142 }],
      "labelAt": { "x": 460, "y": 130 }
    }
  ]
}
```

### Field rules

| Field | Rule |
|---|---|
| `schemaVersion` | integer, `1` in v1. A consumer that does not know the version must refuse, not guess |
| `viewId` | the `views[].id` from `views.yaml`; equals the file name |
| `title` | human title of the view; may be empty only when the view has no title in `views.yaml` |
| `level` | `context \| container \| component \| flow`, copied from `views.yaml` |
| `direction` | `LR \| TB` |
| `canvas` | bounding box of the whole scene as described above |
| `nodes[].id` | the immutable semantic id from `model.yaml`; never a label, never positional |
| `nodes[].type` | `frontend \| service \| worker \| datastore \| queue \| external` |
| `nodes[].label` | the wrapped label text **as one string with `\n`**: core wraps, renderer draws. A label longer than 40 characters is a lint warning; wrapping never exceeds 3 lines and truncates the third with `…` |
| `nodes[].group` | `grp.*` or `null`; a band that is on the view |
| `nodes[].x/y/w/h` | final box after layout **and** after overlays. `w`/`h` are core's text-aware sizes: `w = clamp(140, 40 + longest line × 7.4, 280)`, `h = 16 + lines × 18`, minimum 44 |
| `nodes[].stale` | boolean, from `manifest.json` source hashes vs the files on disk at render time |
| `nodes[].source` | repo-relative path or `null`; the renderer opens it, it never resolves it |
| `groups[].*` | the band geometry core drew; `label` may be empty. Bands are drawn first, under nodes |
| `edges[].id` | the immutable edge id from `model.yaml` |
| `edges[].from/to` | node ids present in this scene's `nodes[]` (otherwise it is a dangling-edge lint error and `render` refuses) |
| `edges[].kind` | `sync \| async \| data`; the renderer picks the line style from it |
| `edges[].label` | required in the model; empty becomes a lint error and the renderer draws nothing, it does not invent text |
| `edges[].points` | at least 2 points, first = source boundary, last = target boundary; intermediate points are ELK bend points |
| `edges[].labelAt` | top-left anchor of the label baseline; core computes it, the renderer renders at it. Placement rule: the anchor sits on the **longest free span** of the polyline (sampled ~2 px) that lies outside every node box of the view, recomputed **after** the overlay merge so a moved node re-places its incident labels. When no free span exists, the polyline midpoint is used and lint reports `label_over_node` at severity warning — the scene is still emitted, the renderer must not reject it |

The scene is **the whole presentation geometry**. The renderer may choose colours,
fonts, stroke widths, icons and the label's exact baseline from a `type`/`kind` table,
but it must not move a node, resize a box, re-route an edge or wrap a label.

## The view index

The panel reads files through a read-only workspace API and cannot list a directory,
so `designmap/out/index.json` is its only way to discover the views. Core writes it
next to the scenes; two runs over the same workspace produce byte-identical bytes.

```json
{
  "schemaVersion": 1,
  "views": [
    {
      "viewId": "v.checkout",
      "title": "Checkout internals",
      "level": "component",
      "direction": "TB",
      "parent": "grp.checkout",
      "scenePath": "out/v.checkout.scene.json",
      "sceneHash": "sha256:…",
      "bytes": 1283
    }
  ],
  "modelHash": "sha256:…",
  "viewsHash": "sha256:…",
  "overlaysHash": "sha256:…"
}
```

| Field | Rule |
|---|---|
| `views[]` | sorted by `viewId`; one row per view in `views.yaml` whose scene was rendered |
| `viewId` | same key name as in the scene, so one identifier is used everywhere |
| `parent` | the group the view zooms into, `null` when the view has no parent; a group id, not a view id |
| `scenePath` | relative to the designmap directory; the renderer resolves it against the directory it was given, never against the document URL |
| `sceneHash` | sha256 of the scene bytes, so the panel can state that what it draws is what the index describes |
| `modelHash`/`viewsHash`/`overlaysHash` | the input hashes those scenes were produced from (`null` when a file is absent) |

**Drill-down rule.** Clicking group `X` on any view opens the view whose `parent` is `X`.
If no view has that parent, the group is simply not a drill target — the renderer shows
no affordance rather than an error. The breadcrumb walks back through the views the human
actually visited, not through a computed hierarchy.

A missing index is not an error: the panel falls back to its fixture view set and says
which path it took. A `schemaVersion` the renderer does not know is refused visibly — the
renderer does not guess at a newer format.

## Overlays

`designmap/overlays.json` holds the human's visual edits and nothing else. Flat map
keyed by semantic node id, exactly as in the spec, so a human can read it:

```json
{
  "$version": 1,
  "svc.checkout.api": { "x": 420, "y": 180, "fill": "#2563eb", "stroke": "#1d4ed8" }
}
```

- `$version` is a reserved key (a semantic id cannot start with `$`). Its absence means
  version 1.
- Allowed per-node keys: `x`, `y`, `fill`, `stroke` — all optional; a partial entry is
  legal. Any other key is ignored with a warning, never applied.
- `x`/`y` are absolute scene coordinates, not deltas: a delta would depend on the
  previous layout, and the overlay must survive a layout change.
- Rows are written by the renderer through the host (debounce 500 ms) and by nothing
  else — an agent tool that tries to write this file is refused (INV-LAYERS, NFR-4).
- Unknown node ids, negative or non-finite coordinates, and colours outside the type
  palette are reported in `merge.gc` / lint and then ignored: overlays can never make
  `render` fail (FR-4).
- `merge` applies `x`/`y` **after** layout, then recomputes the canvas; it never moves
  a node that has no overlay entry.

## Renderer events

The renderer emits exactly these, and the host is the only writer:

| Event | Payload | Host effect |
|---|---|---|
| `nodeMoved` | `{ nodeId, x, y }` | upsert `overlays.json[nodeId].x/y`, `overlay.write` log |
| `colorChanged` | `{ nodeId, fill?, stroke? }` | upsert the colour keys, `overlay.write` log |
| `nodeReset` | `{ nodeId }` | drop that node's overlay row |
| `viewReset` | `{ viewId }` | drop every overlay row of the nodes on that view |
| `drillDown` | `{ groupId }` | `render` the child view |
| `openSource` | `{ nodeId }` | host resolves `source` and opens it; a missing source is a structured refusal |
| `viewChanged` | `{ viewId }` | `render` that view |

No event carries a scene, a model or a layout request. Read-only mode emits only
`drillDown`, `openSource`, `viewChanged`.

## Tool result envelope

`designmap_render` returns the scene **and** the context the footer needs, kept out of
the scene bytes:

```json
{
  "ok": true,
  "viewId": "v.context",
  "scenePath": "designmap/out/v.context.scene.json",
  "sceneHash": "sha256:…",
  "scene": { "schemaVersion": 1, "viewId": "v.context", "...": "…" },
  "stale": { "stale": false, "commitBehind": 0, "staleNodes": [] },
  "lint": { "ok": true, "findings": [] },
  "generatedAt": "2026-11-16T10:00:00.000Z",
  "commit": "a1b2c3d"
}
```

`scene` is bounded: for a view over the node-count limit the envelope still carries the
full scene (the panel needs it) but the agent-facing result may carry `sceneOmitted:
true` plus `scenePath`; the bounded variant is chosen by the host tool, not by the
renderer.

## Empty and absent states

- No `model.yaml`, or a model with no nodes applicable to the view: a **valid** scene
  with `nodes: []`, `edges: []`, `groups: []`, `canvas` of zero size and `title` from
  the view. The renderer draws its empty state; this is not an error (INV-EMPTY).
- An unknown `viewId` is a structured error (`unknown_view`), never an empty scene —
  conflating the two would hide a typo.

## Changing this contract

A field added, removed or re-typed after M0 starts is a contract change: the
implementer calls `analysis_impact` on `designmap-redesign` (kind `contract`, target
`CT-SCENE`), updates this document with a bumped `v2` section and only then changes
code. M1 may add renderer-internal state (selection, hover, zoom) freely; it may not
add a field that core would have to produce.
