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

## The agent's view

`design_map` takes boxes and arrows, not coordinates:

```json
{"op":"upsert","nodes":[{"id":"web","label":"Web client"},{"id":"host","label":"Host"}],
 "edges":[{"from":"web","to":"host","label":"command"}]}
```

- `op: "read"` returns `rev`, `updatedAt`, `updatedBy`, `ageMs`, `stale`, and the current
  nodes/edges with their real positions. `stale` is the orchestrator's cue to refresh.
- `write` replaces the whole element list; `upsert` adds or updates only the named nodes
  and edges and preserves freehand annotations; `remove` deletes ids (arrows attached to a
  removed node go with it).
- `layout` rearranges **every** design-map node by graph rank and content size, re-routes
  every arrow, and requires the `rev` it read (compare-and-set). An ordinary `upsert` never
  moves a node already in the scene - the payload's `x`/`y` are ignored for it - so the
  human's drag survives. `layout` is the explicit operation that may reposition.
- Missing `x`/`y` are placed by graph rank: back edges are removed for ranking, so a cycle
  stays a left-to-right flow; nodes are ordered within a rank by their predecessors.
  Placement uses each node's real size and every existing rectangle, and keeps a
  `NODE_GAP` (56px) of clear space around every box.
- `width`/`height` are floors, not caps: a box is never smaller than its wrapped label.
  Labels are content-sized multiline text at 17px / line-height 1.25 with 5px padding,
  wrapped with the Arial/Helvetica advance widths the frame itself measures.
- A node is an Excalidraw rectangle with a bound text label; an edge is a bound arrow that
  starts and ends on a side midpoint and is routed orthogonally on a visibility grid, so it
  detours around unrelated boxes instead of crossing them. The human's drags and renames
  show up in the next `read` unchanged. Rebuilding a node also rebuilds its bindings from
  **every** arrow in the scene that points at it, not only the arrows in the same call, so
  an upsert does not detach the human's existing arrows.
- Before an agent write is persisted the scene is validated: clipping, overlap (below
  2px; 56px is the automatic placement target), non-finite geometry and an arrow through
  **any** live rectangle - including a plain human shape, not only a design-map node - are
  refused with `layout_invalid`. An explicit `x`/`y` is validated like any other position.
  A human box that was already clipped is left where it is and returned in
  `layout.warnings` (run `layout` to repair it); boxes the agent writes and the whole map
  after `layout` are content-sized. Rebuilding a node preserves its colour, angle, group,
  stroke, opacity, link and lock; its label keeps its colour/opacity/group/angle/link/lock
  (font size and family stay with the content-sizing system). Rebuilt arrows keep their
  stroke group/opacity/arrowheads. Every human arrow stays bound to the rebuilt node.
  `remove` cleans the removed id out of both endpoints' `boundElements`, so no binding
  dangles. A label id is not independently removable: `remove` refuses it with `label_id`
  and names the owning node.

### Refusals, the revision and the caps

Every refusal is a value with a stable code — the tool returns
`{ok:false, code, message}` and the command returns `{kind:"error", text:"design-map: <code>: …"}`:

| code | when |
| --- | --- |
| `empty_write` | `write` with no nodes and no edges. It would erase the map; pass `clear: true` to mean it |
| `needs_rev` | a `write`/`save` over a NON-EMPTY scene without the `rev` the caller read |
| `stale` | the `rev` given is not the scene's current rev (checked on write, save and, when given, upsert/remove) |
| `duplicate_node_id` / `duplicate_edge_id` | the same id twice in one payload |
| `invalid_node` / `invalid_edge` | a node that is not an object or has a non-string/empty id; an edge that is not an object or has no `from`/`to` |
| `unknown_edge_node` | an edge endpoint that is not a node in the resulting map (it used to be dropped silently) |
| `unknown_id` | `remove` of an id that is not in the scene (it used to be a silent no-op) |
| `label_id` | `remove` of a node's text label id; remove the owning node instead |
| `too_many_nodes` / `too_many_edges` / `too_many_elements` | the document caps, below |
| `needs_elements` / `invalid_element` / `duplicate_id` | the panel save's shape: an elements array of objects with unique string ids |
| `invalid_layout` / `empty_layout` | `layout` with nodes/edges in the payload, or with no design-map node to rearrange |
| `layout_invalid` | the final scene would clip a label, overlap two boxes, hold non-finite geometry or route an arrow through an unrelated node |

**The caps are the document's, not the caller's.** 200 nodes, 400 edges, 1000 elements — and
the panel's `save` is held to the same numbers (a browser save used to write 5000 elements
while the tool refused 201 nodes).

**A whole-scene write is a compare-and-set.** The map on disk may be newer than the one the
caller read; overwriting it without that `rev` is how a "refresh the map" call would erase a
human's last drag. Read, then write with the rev you read. An empty scene needs no rev.

## The human's view

The **Design map** panel embeds Excalidraw in an iframe `srcdoc` built from
`client.frame.js`, a vendored bundle of `@excalidraw/excalidraw` 0.18.1 (MIT). The frame
posts debounced edits to the panel, which saves them through `/design-map`; the host
stamps the revision and author. The file is read through `workspaceFiles`, so the same
`design.excalidraw` is visible in the Files panel and survives a restart.

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
