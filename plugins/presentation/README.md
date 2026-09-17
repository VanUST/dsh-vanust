# @cc/dsh-presentation

One tool, one file: the agent turns a JSON deck spec into a **standalone HTML
presentation** in the session workspace, and the harness displays it.

## Why there is almost no UI here

The Sidebar document preview already renders `.html`/`.htm` documents
(`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`): it loads the file bytes and
mounts them in an opaque iframe with `sandbox="allow-scripts"`. So a deck needs no
custom panel, no host route and no image rendering — writing a self-contained HTML
file is the whole feature. The same document is what the user exports and prints,
which is why preview, export and PDF cannot disagree.

## The tool

`presentation({ spec, out? })`

- `spec` — the deck spec as a JSON string.
- `out` — optional file name or absolute path; defaults to `presentation.html` in
  the session workspace.

Returns `{ ok, degraded, path, bytes, theme, slides, errors, warnings }`. A bad spec is
a reported result, never a throw: an unknown slide type is named with its index and the
remaining slides still render.

`ok` means **a file was written**, nothing more — validity lives in `errors`, and
`degraded` is true exactly when `errors` is non-empty, so a caller that ignores `errors`
cannot mistake a fallback deck for a clean one. A failure to parse or render returns
`{ ok: false, errors }` with no `degraded`, because there is no deck to describe.

### Spec shape

```json
{
  "theme": "ember",
  "title": "…",
  "slides": [
    {
      "type": "cover | section | content",
      "kicker": "…", "title": "…", "lede": "…",
      "cards":    [{ "title": "…", "text": "…", "color": "info|ok|danger|violet", "list": ["…"] }],
      "kpis":     [{ "value": "…", "label": "…", "note": "…", "color": "…" }],
      "table":    { "header": ["…"], "rows": [["…"]] },
      "timeline": [{ "title": "…", "text": "…" }],
      "quote":    { "text": "…", "by": "…" },
      "chips":    { "label": "…", "items": ["…"] },
      "callout":  "…",
      "note":     "…"
    }
  ]
}
```

Text fields accept `**bold**` and `==highlight==`; everything else is escaped.
Themes: `ember` (default), `graphite`, `aurora`, `mono`, `paper` — a theme is a
token set in `theme.css`, switched by one attribute, so nothing else changes.

### Constraints the generated document obeys

The preview packs the document into a sandboxed iframe, so the deck must be
self-contained and conservative:

- inline `<style>` and one **classic** inline `<script>` — no ES modules;
- no local `url()`, `@import` or sibling asset files;
- a remote font link is allowed but optional, so every font stack ends in a
  system fallback;
- no dependency on the parent application (opaque origin: no storage, no API calls).

Keyboard: `←`/`→`, `Space`, `Home`/`End`, `1…9`, `F` (full screen); `#N` deep-links
to a slide. Printing gives one slide per page.

## Files

| File | Role |
|---|---|
| `index.js` | host half: `name`/`inject`/`apply`, registers the tool |
| `plugin-presentation.mjs` | the tool definition: parse, render, write |
| `render.mjs` | pure renderer: spec → standalone HTML (exported for reuse and tests) |
| `theme.css` | the five themes and every component, as tokens |
| `test-render.mjs` | self-test of the renderer: `node plugins/presentation/test-render.mjs` |
| `test-tool.mjs` | self-test of the tool's result contract — no `undefined` in the payload, every failure reported: `node plugins/presentation/test-tool.mjs` |

The result contract is not cosmetic: the harness serialises a tool result as lossless
JSON and refuses a value that carries `undefined`, so a payload that leaks one is
rejected before the model sees it while the file is still written. `lossless()` in
`plugin-presentation.mjs` strips such keys, and `test-tool.mjs` is the regression test
for that class of defect.

`theme.css` originates from the workspace style kit that was reviewed and approved
before this plugin existed; this copy is the one the shipped renderer uses.

## Not included on purpose

A filmstrip/comment panel, version history and a theme switcher were designed and
rejected for the first release: the document preview already presents the deck, and
a client half would add a browser bundle to maintain before it adds anything the
user cannot already do. They remain a later step, and the spec above is the
interface they would attach to.
