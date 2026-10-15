# @cc/dsh-diagrams

One tool, one file: the agent turns a JSON **diagram spec** into a **standalone HTML
document with inline SVG** in the session workspace, and the harness displays it.

Four kinds, one contract: `flow` (flowcharts and algorithm illustrations), `arch`
(layered system design), `sequence` (message order), `state` (state machines). The
agent describes nodes and relationships; the plugin computes every coordinate.

## Why there is almost no UI here

The Sidebar document preview already renders `.html`/`.htm` documents
(`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`): it loads the file bytes and
mounts them in an opaque iframe with `sandbox="allow-scripts"`. So a diagram needs no
custom panel, no host route and no image rendering — writing a self-contained HTML file
is the whole feature. The same document is what the user prints, which is why preview
and print cannot disagree.

## The tool

`diagram({ spec, out? })`

- `spec` — the diagram spec as a JSON string.
- `out` — optional file name or absolute path; defaults to `diagram.html` in the session
  workspace.

Returns `{ ok, degraded, path, bytes, kind, theme, nodes, edges, legend, errors, warnings }`.
A bad spec is a reported result, never a throw: an unknown kind, an unknown theme or an
edge naming a node that does not exist is named in `errors`, and everything drawable
still renders.

`ok` means **a file was written**, nothing more — validity lives in `errors`, and
`degraded` is true exactly when `errors` is non-empty, so a caller that ignores `errors`
cannot mistake a fallback diagram for a clean one. A spec from which nothing drawable
remains returns `{ ok: false, errors }` with no `degraded`, because there is no document
to describe.

## Spec shape

```json
{
  "kind": "flow | arch | sequence | state",
  "theme": "ember",
  "title": "…",
  "subtitle": "…"
}
```

`kind` selects the layout and the keys it reads. A node may be written as
`{"id","label","shape","note","color","rank"}` or as a bare `"id"` string; an edge's
endpoints may be `from`/`to` or `source`/`target`.

### `flow` (default) and `state`

```json
{
  "direction": "down | right",
  "nodes": [{ "id": "check", "label": "tokens >= 1?", "shape": "diamond", "color": "accent", "note": "…", "rank": 2 }],
  "edges": [{ "from": "check", "to": "take", "label": "yes", "style": "solid", "color": "ok", "fromSide": "bottom", "toSide": "top" }],
  "groups": [{ "id": "g", "label": "Pass k", "color": "info", "nodes": ["a", "b"] }]
}
```

`rank` pins a node to a layer; `fromSide`/`toSide` pin an edge to a named side of its
box (`top`/`bottom`/`left`/`right`, read in the orientation you see). Both are escape
hatches for a layout you want to overrule — most specs should omit them. `groups` draw a
labelled region around their members. `state` is `flow` with rounded nodes by default;
use `shape: "start"` and `shape: "end"` for the entry and exit markers.

### `arch` — a system design

```json
{
  "layers": [
    { "label": "Clients", "color": "info", "items": [{ "id": "web", "label": "Web app" }] },
    { "label": "Data", "color": "ok", "items": [{ "id": "pg", "label": "Postgres", "shape": "cylinder" }] }
  ],
  "links": [{ "from": "web", "to": "pg", "label": "SQL", "style": "thick" }]
}
```

Each layer is a band; `items` are its boxes. Band colours rotate through the palette
when a layer declares none. `columns` (default 4) wraps a layer with many items.
`direction` is always top-down here; asking for `"right"` warns and draws it top-down.

### `sequence` — message order

```json
{
  "numbering": true,
  "actors": [{ "id": "app", "label": "App" }],
  "messages": [
    { "from": "app", "to": "cache", "label": "GET order:42" },
    { "from": "cache", "to": "app", "label": "miss", "style": "dashed" },
    { "from": "app", "to": "app", "label": "sleep 2^k", "note": "k doubles per failure" }
  ]
}
```

A message whose `from` equals its `to` is drawn as a self call and may carry a `note`,
which becomes an annotation box. `kind: "return"` is shorthand for `style: "dashed"`.

`blocks` wrap a run of messages in an `alt`/`opt`/`loop`/`par` frame, addressing the run by
message number (1-based):

```json
{
  "blocks": [
    { "type": "loop", "label": "up to 5 attempts", "from": 2, "to": 4 },
    { "type": "alt", "label": "authorised", "from": 5, "to": 7 }
  ]
}
```

The row spacing reserves room for a frame's label tab above the message it opens, so two
adjacent frames and a frame's first label never collide.

### `legend` — any kind

```json
{
  "legendTitle": "Components",
  "legend": [
    { "label": "Service", "shape": "round", "color": "info" },
    { "label": "Object store", "shape": "cylinder", "color": "ok" },
    "A plain string is a label with no swatch"
  ]
}
```

The legend is HTML below the diagram rather than part of the SVG, so it stays put while the
diagram is panned and it prints as text. `legend: true` draws a colour key derived from the
colours the nodes actually use — honest about being a key to the palette, not to your
meaning, which is why an authored legend is worth the four lines.

### Vocabulary

| Field | Values |
|---|---|
| `shape` | `rect`, `round`, `pill`, `diamond`/`decision`, `circle`, `cylinder`/`database`/`store`, `parallelogram`/`data`, `hexagon`/`loop`, `note`, `start`, `end` |
| `color` | `accent`, `info`, `ok`, `warn`, `danger`, `violet`, `cyan`, `muted` |
| edge `style` | `solid`, `dashed`, `dotted`, `thick` |
| `theme` | `ember` (default), `graphite`, `aurora`, `mono`, `paper` |

A theme is a token set in `theme.css`, switched by one attribute, so nothing else
changes. The palette is the one `@cc/dsh-presentation` uses, so a diagram and a deck
from the same workspace look like the same family; the copy here is deliberate, because
two separately installed plugins cannot share a stylesheet.

### Constraints the generated document obeys

The preview packs the document into a sandboxed iframe, so a diagram is self-contained
and conservative:

- inline `<style>` and one **classic** inline `<script>` — no ES modules;
- no local `url()`, `@import`, sibling asset file or web font, so it renders offline;
- no dependency on the parent application (opaque origin: no storage, no API calls);
- 17–23 KB per diagram, layout included.

Keyboard: `F` fit, `T` cycle theme, `+`/`−` zoom; drag pans, the wheel zooms, and the
buttons do the same. Printing gives the whole diagram on one landscape page.

## Files

| File | Role |
|---|---|
| `index.js` | host half: `name`/`inject`/`apply`, registers the tool |
| `plugin-diagrams.mjs` | the tool definition: parse, render, write |
| `render.mjs` | spec validation, the HTML document, the viewer script |
| `layout.mjs` | geometry: layered ranking, architecture bands, sequence lifelines |
| `svg.mjs` | SVG primitives: text metrics, node shapes, edge routing, markers |
| `theme.css` | the five themes and every component, as tokens |

The result contract is not cosmetic: the harness serialises a tool result as lossless
JSON and refuses a value that carries `undefined`, so a payload that leaks one is
rejected before the model sees it while the file is still written. `lossless()` in
`plugin-diagrams.mjs` strips such keys.

## How it lays out

`layout.mjs` is the whole geometry engine and has no dependency:

- **Ranking.** A layered (Sugiyama-style) pass: cycles are detected and their back edges
  removed before ranking, ranks come from the longest path, and a barycentre sweep
  orders each rank against its neighbour. A graph with a cycle still lays out. Each rank
  then slides as one rigid body to line up with the rank it flows from, which turns a
  chain into a straight run instead of a staircase — a rigid shift cannot reorder a rank or
  overlap two of its nodes, so it cannot undo the sweep's work.
- **Routing.** A box-to-box router that picks the facing sides, draws a cubic for a
  short hop, and takes an orthogonal detour outside the graph for a skip or a back edge,
  one lane per detour so two never overlap. A channel is not a hint: an edge that must
  avoid the ranks between its ends never takes the direct curve, however well its two
  sides face each other. The scene then grows to contain the detour.
- **Labels.** Every label is measured arithmetically and nudged off the nodes and off the
  other labels, because two crossing edges otherwise compute the same spot.
- **Text.** No browser and no font metrics at render time: widths come from a per-character
  estimate, which is what makes one spec produce one byte-identical file everywhere.

## Not included on purpose

A drag-and-drop editor, PNG export, a stand-alone `.svg` file and a mermaid-syntax input
were all considered and left out of the first release. The document preview already
presents and prints the diagram, so a client half would add a browser bundle to maintain
before it adds anything the user cannot already do. The spec above is the interface they
would attach to.
