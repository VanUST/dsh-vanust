# @cc/dsh-design-map — one map the orchestrator and the human both edit

`design.excalidraw` at the workspace root is a normal Excalidraw scene. The orchestrator
writes it with the `design_map` tool; the human opens **Design map** in the sidebar and edits
the same file in the real Excalidraw editor. There is one document, one revision counter and
no second store.

**The map has two owners, and a tool is a permission.** `design_map` is registered per agent
on `agent/created` and only for the `orchestrator` preset: a BACKEND, UX/UI, RESEARCH,
REVIEWER or DOCS child never receives it, so it cannot rewrite the design of the system it
was asked to work inside - a tool an agent never got cannot be argued into existence by a
brief. The `/design-map` command is NOT gated: it is the human's panel path and keeps
working for every session. An absent/unknown preset gets no tool, because an ownership
boundary fails closed.

## The visual language

The agent chooses meaning; the plugin chooses the drawing. Every accepted input is visible:

| input | what the human sees |
| --- | --- |
| `nodes[].kind: "service"` (default) | a rectangle |
| `nodes[].kind: "store"` | an ellipse (data at rest) |
| `nodes[].kind: "decision"` | a diamond (a branch) |
| `nodes[].kind: "external"` | a dashed rectangle (outside the system) |
| `nodes[].label` | a bound text inside the shape, edited by double-click |
| `nodes[].color` | the shape's fill; defaults to the kind's colour |
| `edges[].label` | a bound text on the arrow, edited by double-click |
| `layers[]` | a titled, dashed, locked band the member nodes stand in |
| `title` | one text above the map |

All three shapes accept a bound label in Excalidraw 0.18.1
(`ExcalidrawTextContainer = rectangle | diamond | ellipse | arrow`), so a label stays a
first-class editable object on every kind. A band is **locked and not grouped**: grouping
would make a drag on any member move the whole layer, which is the opposite of what editing
one box should do; a locked band is decoration the agent owns, so it never steals a click.

## The agent's view

`design_map` takes boxes, layers and arrows, not coordinates:

```json
{"op":"write","title":"How one chat is served",
 "layers":[{"id":"client","label":"Client"},{"id":"host","label":"Host"},{"id":"store","label":"Storage"}],
 "nodes":[{"id":"web","label":"Web client","layer":"client"},
          {"id":"host","label":"Host service","layer":"host"},
          {"id":"db","label":"Taskboard","layer":"store","kind":"store"}],
 "edges":[{"from":"web","to":"host","label":"command"},{"from":"host","to":"db","label":"event"}]}
```

- `op: "read"` returns `rev`, `updatedAt`, `updatedBy`, `ageMs`, `stale`, `title`, the compact
  nodes/edges/layers, `health` and a `preview`. `stale` is the orchestrator's cue to refresh.
- `write` replaces the whole element list; `upsert` adds or updates only the named nodes,
  layers and edges and preserves freehand annotations; `remove` deletes ids (arrows attached
  to a removed node go with it, and so do their labels).
- `layout` rearranges **every** design-map node by graph rank and content size, re-routes
  every arrow, rebuilds every band and requires the `rev` it read (compare-and-set). An
  ordinary `upsert` never moves a node or a band already in the scene - the payload's `x`/`y`
  are ignored for an existing node - so the human's drag survives. `layout` is the explicit
  operation that may reposition.
- **Placement without layers** is a left-to-right graph: back edges are removed for ranking,
  so a cycle stays a left-to-right flow, and nodes are ordered within a rank by their
  predecessors. Placement uses each node's real size and every existing rectangle, and keeps
  a `NODE_GAP` (56px) of clear space around every box.
- **Placement with layers** is a grid: one column per graph rank, one full-width band per
  layer in the declared order. A node belongs to exactly one layer (`node.layer`), and a
  band never lists its members - one source of truth. A `write` lays the bands out in the
  order given; a `layout` does the same and is the operation that can relabel or **reorder**
  the bands of an existing map (`layers[]` is accepted there); an `upsert` keeps the bands
  it finds exactly where they are and appends new ones at the bottom, because moving a band
  would move the ground under boxes the upsert was told not to touch. New nodes fill a free
  cell of their band; when the band has no free cell the call is refused with `layer_full`
  and a `run layout` hint.
- **Converting an unlayered map to layers** is one call that names every node's layer, or a
  `write` of the full map; a partial upsert that leaves an existing node without a layer is
  refused with `layer_required` before anything is written.
- `width`/`height` are floors, not caps: a shape is never smaller than its wrapped label.
  Labels are content-sized multiline text at 17px / line-height 1.25 with 5px padding,
  wrapped with the Arial/Helvetica advance widths the frame itself measures. A non-rectangle
  kind grows past the label by the inscribed rectangle: `√2` for an ellipse, `2` for a
  diamond, so a two-word label cannot spill over the shape's edge.
- A node is a shape with a bound text label; an edge is a bound arrow that starts and ends
  on a side midpoint and is routed orthogonally on a visibility grid, so it detours around
  unrelated boxes instead of crossing them. The human's drags and renames show up in the next
  `read` unchanged. Rebuilding a node also rebuilds its bindings from **every** arrow in the
  scene that points at it, not only the arrows in the same call, so an upsert does not
  detach the human's existing arrows. Rebuilding an edge removes and redraws its label.

### The agent sees what it drew

Every result carries `preview` and `health`:

```
dsh-kit: how one chat is served - rev 4, 6 nodes, 5 flows, 3 layers, 29 elements

         stage 1            stage 2         stage 3
Client   [Web client]       /GitHub/
Host     <Ownership gate?>  [Host service]  (Plugin registry)
Storage                                     (Taskboard)

flows: Web client -> Host service "command"; Host service -> Taskboard "event"; ...
health: ok - labels fit, nothing overlaps, arrows stay clear
legend: [service] (store) <decision> /external/; a band is a layer, top to bottom
```

`preview` is rendered from the scene's **real geometry** - the columns are the boxes' actual
x-ranges, the rows are the actual bands - so it shows what the human will see, including a
map a human dragged around. It is bounded (44 lines, 30 characters per cell) and says when it
truncated. `health` is the validator's verdict on the scene as it stands: `ok`, or the
issues with a `run layout` hint. `health.ok === false` on a read is the agent's cue that the
map needs `layout`, not another blind edit.

### Refusals, the revision and the caps

Every refusal is a value with a stable code — the tool returns
`{ok:false, code, message}` and the command returns `{kind:"error", text:"design-map: <code>: …"}`:

| code | when |
| --- | --- |
| `empty_write` | `write` with no nodes, edges or layers. It would erase the map; pass `clear: true` to mean it |
| `needs_rev` | a `write`/`save` over a NON-EMPTY scene without the `rev` the caller read |
| `stale` | the `rev` given is not the scene's current rev (checked on write, save and, when given, upsert/remove) |
| `duplicate_node_id` / `duplicate_edge_id` / `duplicate_id` | the same id twice in one payload, or in the resulting scene |
| `invalid_node` / `invalid_edge` / `invalid_layer` | a node/edge/layer that is not an object or lacks a non-empty string id |
| `invalid_kind` | `kind` outside `service`, `store`, `decision`, `external` |
| `layer_required` | the map has layers but the node names none |
| `unknown_layer` | a node names a layer that is not declared (or the map has no layers at all) |
| `layer_full` | an upsert cannot fit a new node in its band without moving the next band; run `layout` |
| `unknown_edge_node` | an edge endpoint that is not a node in the resulting map |
| `unknown_id` | `remove` of an id that is not in the scene |
| `layer_id` | `remove` of a layer band: it owns no members, so deleting it would trap the map; remove or move its member nodes |
| `label_id` | `remove` of a bound label id; remove its owner instead |
| `too_many_nodes` / `too_many_edges` / `too_many_layers` / `too_many_elements` | the document caps, below |
| `needs_elements` / `invalid_element` | the panel save's shape: an elements array of objects with unique string ids |
| `invalid_layout` / `empty_layout` | `layout` with nodes/edges in the payload, or with no design-map node to rearrange |
| `layout_invalid` | the final scene would clip a label, overlap two boxes, hold non-finite geometry, route an arrow through an unrelated node, put a node outside its band, overlap two bands or put a node in a band it does not belong to |

**On an upsert, only a defect THIS call introduced is refused.** The result is compared with
the scene before the call; a clipped human box or a node a human dragged out of its band is
returned in `layout.warnings` with `(pre-existing; run layout to repair)` instead of blocking
an unrelated edit - an ordinary upsert must not move a human's box to fix it.

**The caps are the document's, not the caller's.** 200 nodes, 400 edges, 32 layers, 2000
elements — and the panel's `save` is held to the same numbers. A node is a shape plus its
bound label, an edge is an arrow plus its label, a layer is a band plus its title: the total
leaves room for all of them and for the human's freehand strokes. A band is not counted
against the node cap (it is a rectangle, but it is not a node).

**A whole-scene write is a compare-and-set.** The map on disk may be newer than the one the
caller read; overwriting it without that `rev` is how a "refresh the map" call would erase a
human's last drag. Read, then write with the rev you read. An empty scene needs no rev.

## The human's view

The **Design map** panel embeds Excalidraw in an iframe `srcdoc` built from
`client.frame.js`, a vendored bundle of `@excalidraw/excalidraw` 0.18.1 (MIT). The frame
posts debounced edits to the panel, which saves them through `/design-map`; the host
stamps the revision and author. The file is read through `workspaceFiles`, so the same
`design.excalidraw` is visible in the Files panel and survives a restart.

What the human can edit: double-click any shape's label or any arrow's label and type;
drag a shape by its border (not its text); drag an arrow's endpoints; delete, recolour and
re-group anything Excalidraw allows. A band is locked decoration, so it never intercepts a
click; the title is ordinary text.

The frame is a package-local chunk fetched from the APP-ABSOLUTE route
(`/plugins/@cc/dsh-design-map/client.frame.js?rev=…`) — a relative `plugins/...` resolved
against the document and 404'd below the root. It is a package-local chunk,
with no CDN and no network at runtime. It is built with:

```bash
cd frame-src
npm install
node build.mjs          # writes ../client.frame.js (~3.4 MB)
```

The build replaces Excalidraw's ~49 non-English locale bundles and its Mermaid import
dialog with stubs; without that the frame is ~8.4 MB. Everything else is the real editor.

## Persistence contract

- Scene writes are temp-file + rename. A refusal happens BEFORE the write, so the file on
  disk is byte-identical after a refused call.
- The panel sends `elements`/`appState`/`files` plus the `rev` it last read (the host checks
  it on a non-empty scene); `rev`, `updatedAt` and `updatedBy`
  are assigned by the host, never trusted from the browser.
- `save` is the same service the tool uses, so an agent write and a human save cannot
  produce two different file shapes.

## Known limits

- Edge labels are placed above the longest straight run of their arrow. Two labels that
  meet at the same box can crowd each other; the geometry is still valid (labels are text,
  not obstacles) and `layout` re-routes the arrows.
- Above ~20 nodes a dense map's arrows may still cross each other. The validator refuses an
  arrow through a box, not two arrows through each other.
