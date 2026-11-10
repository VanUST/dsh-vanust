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
- Missing `x`/`y` are laid out in a grid; `width`/`height`/`color` are optional.
- A node is an Excalidraw rectangle with a bound text label; an edge is a bound arrow.
  The human's drags and renames therefore show up in the next `read` unchanged.

## The human's view

The **Design map** panel embeds Excalidraw in an iframe `srcdoc` built from
`client.frame.js`, a vendored bundle of `@excalidraw/excalidraw` 0.18.1 (MIT). The frame
posts debounced edits to the panel, which saves them through `/design-map`; the host
stamps the revision and author. The file is read through `workspaceFiles`, so the same
`design.excalidraw` is visible in the Files panel and survives a restart.

The frame is a package-local chunk (`/plugins/@cc/dsh-design-map/client.frame.js?rev=…`),
with no CDN and no network at runtime. It is built with:

```bash
cd frame-src
npm install
node build.mjs          # writes ../client.frame.js (~3.4 MB)
```

The build replaces Excalidraw's ~49 non-English locale bundles and its Mermaid import
dialog with stubs; without that the frame is ~8.4 MB. Everything else is the real editor.

## Persistence contract

- Scene writes are temp-file + rename.
- The panel sends only `elements`/`appState`/`files`; `rev`, `updatedAt` and `updatedBy`
  are assigned by the host, never trusted from the browser.
- `save` is the same service the tool uses, so an agent write and a human save cannot
  produce two different file shapes.
