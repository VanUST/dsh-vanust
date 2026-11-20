# @cc/dsh-presentation

Two tools, two documents: the agent turns a JSON spec into a **standalone HTML deck**
or a **standalone HTML board** in the session workspace, and the harness displays it.

**Design-role plugin.** It registers for the preset ids `presenter`, `ux` and
`standard` only; a backend or reviewer session has no deck tool. A session with no
recorded preset keeps it. A preset id outside that list keeps nothing, and a preset
whose tool-families allow list does not name `presentation`/`dashboard` loses the tool
again at the policy layer.

## Why there is almost no UI here

The Sidebar document preview already renders `.html`/`.htm` documents
(`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`): it mounts the file bytes in an
opaque iframe with `sandbox="allow-scripts"`. So a deck needs no custom panel, no host
route and no image rendering — writing a self-contained HTML file is the whole
feature. The same file is what the user opens, prints or hands over, which is why
preview, print and PDF cannot disagree.

## The tools

### `presentation({ spec, out? })`

- `spec` — the deck spec as a JSON string.
- `out` — optional file name or absolute path; defaults to `presentation.html` in the
  session workspace.

Returns `{ ok, degraded, path, bytes, theme, slides, errors, warnings }`.
`ok` means **a file was written**, nothing more — validity lives in `errors`, and
`degraded` is true exactly when `errors` is non-empty, so a caller that ignores
`errors` cannot mistake a fallback deck for a clean one. A spec that cannot be parsed
at all returns `{ ok: false, errors }` with no file.

### `dashboard({ spec, out? })`

The same contract for a board spec; defaults to `dashboard.html`. Returns
`{ ok, degraded, path, bytes, theme, tiles, charts, errors, warnings }`.

## Deck spec

```json
{
  "theme": "ember | graphite | aurora | mono | paper",
  "title": "document title (the <title>)",
  "lang": "ru",
  "foot": "small line printed on section slides",
  "slides": [ { "type": "cover | section | content | compare | steps | chart | visual | raw" } ]
}
```

A slide accepts `kicker`, `title`, `lede`, `note` (speaker notes, `N`), `flush`
(drops the frame and grid), `layout` (`row` for horizontal steps) and these blocks,
rendered in a fixed order regardless of key order:

| Block | Shape |
|---|---|
| `cards` | `[{ title, text, list: [..], color, step, icon, big, ghost }]` — 1–5 columns |
| `kpis` | `[{ value, label, note, color }]` — a numeric value counts up |
| `table` | `{ header: [..], rows: [[..]], compact }` |
| `timeline` | `[{ title, text }]` |
| `quote` | `{ text, by }` |
| `chips` | `{ label, items: [".." or { text, on }] }` |
| `callout` | `"sentence"` or `{ text, tone }` — `tone` is accent/ok/danger/info |
| `list` | `[".." or { title, text }]` |
| `steps` | `[{ title, text, num }]` — each step is a fragment |
| `compare` | `{ left: { head, title, text, list }, right: { … }, arrow }` |
| `chart` | `{ kind: "bar\|line\|donut\|sparkline", data, series, unit, caption }` |
| `motion` | a timed scene: `{ svg \| html, duration?, autoplay?, pace?, loop?, tracks: [{ target, at, dur, ease?, from?, to?, repeat? }], captions: [{ at, dur, text }], caption? }` |
| `visual` | `{ svg \| html, caption, flush }` — an inline SVG the agent supplies |
| `code` | `{ title, text }` |

`cover` takes `meta: ["..", ..]` for the line under the title. `raw` takes `html`,
and optionally `css`/`js` — the escape hatch for motion the spec does not describe.

Any block may carry `frag: true`: it then appears on the next advance instead of with
the slide, so a slide can show a change rather than its result.

Text fields accept `**bold**` and `==highlight==`; everything else is escaped. A value
that starts with a number (`"93,8 %"`) counts up on entry.

## Board spec

```json
{
  "theme": "graphite",
  "kicker": "..", "title": "..", "subtitle": "..", "meta": [".."],
  "tiles":  [{ "value": "162", "label": "..", "delta": "+6", "tone": "ok", "note": ".." }],
  "charts": [{ "kind": "bar|line|donut|sparkline", "title": "..", "unit": "..", "data": [..], "series": [..], "foot": ".." }],
  "lists":  [{ "title": "..", "items": [{ "label": "..", "value": "high", "tone": "danger" }] }],
  "foot":   ["..", ".."]
}
```

Charts are the same four kinds a deck uses, drawn by `charts.mjs`. A board is fluid:
it fills the sidebar at any width and prints on one page.

## Timed scenes (`motion`)

A deck can show a process by frames (one advance per state) or by clock. The `motion`
block is the clock: the scene markup states each element's START state (`data-id` plus
an `opacity` or position), the tracks state the CHANGE with an absolute `at` and a
`dur`, and the player turns every track into a Web Animation with a delay — so the
sequence runs on the compositor clock, `P` pauses it, `R` replays it, a progress bar
and a clock show where it is, and captions change in step. There is no library behind
it: `Element.animate()` is the runtime, which keeps the document one file and ~0 bytes
of dependency (the whole player, scene runtime included, is 16 KB of source).

```json
{"type": "content", "title": "Prefill, cache, decode",
 "motion": {
   "svg": "<svg viewBox='0 0 900 320'><g data-id='prompt' opacity='0.2'>…</g></svg>",
   "duration": 4200,
   "captions": [{"at": 0, "dur": 1400, "text": "The model reads the prompt"}, …],
   "tracks": [
     {"target": "prompt", "at": 0,    "dur": 600, "to": {"opacity": 1}},
     {"target": "kv",     "at": 1400, "dur": 900, "to": {"opacity": 0.9}}
   ]}}
```

Rules that make it reliable: a target must exist in the scene (the renderer refuses a
misspelled `data-id` instead of animating nothing); a scene element must not carry its
own `transform` attribute (the timeline owns `transform`); `prefers-reduced-motion`
lands on the final state; print shows the final state with the last caption. A `from`
is optional — without it the animation starts from the element's current value.

## The style system

`theme.css` is one token layer plus one component layer:

- **Themes** define the same semantic tokens — `--ink`, `--muted`, `--accent`,
  `--danger`, the four chart tones, `--card-bg`, the surface wash — and nothing else.
  `data-theme` on `<html>` is the whole switch; a component never names a hex value.
- **Scales**: nine type steps, a 4/8 spacing scale, one radius per role, three
  durations. A component that needs a new size adds a token, not a number.
- **Motion**: 150–320 ms with ease-out, opacity and transform only. A fragment is
  `.is-here`; a slide entrance is `.is-in`. `prefers-reduced-motion` removes both.
- **Print**: `@page` plus `break-after: page`, so a 16:9 slide is one printed page.

## Constraints the generated documents obey

The preview packs a document into a sandboxed iframe (opaque origin), so:

- inline `<style>` and **one classic** inline `<script>` — no ES modules;
- no `<link>`, no `@import`, no `url(`, no `http(s)` reference, no sibling assets;
- type stacks end in a system fallback, so nothing is fetched for a font;
- no storage and no API calls (an opaque origin refuses both).

Keyboard: `←`/`→`, `Space`, `Home`/`End`, `1…9`, `F` full screen, `O` overview,
`N` speaker notes; `#N` deep-links to a slide, and a click on the slide advances it
(the frame owns the keyboard only after a click, so the click is the reader's
control). Printing gives one slide per page.

## Files

| File | Role |
|---|---|
| `index.js` | host half: preset gate, tool registration, re-exports for proofs |
| `plugin-presentation.mjs` | the two tool definitions: parse, render, write |
| `render-deck.mjs` | pure deck renderer: spec → standalone HTML |
| `render-board.mjs` | pure board renderer: spec → standalone HTML |
| `charts.mjs` | bar/line/donut/sparkline as inline SVG, no dependency |
| `player.mjs` | the deck player and the board's entrance script, as source strings |
| `text.mjs` | escaping, inline markers, number formatting, tone naming |
| `theme.css` | the five themes and every component, as tokens |

The result contract is not cosmetic: the harness serialises a tool result as lossless
JSON and refuses a value that carries `undefined`, so `lossless()` in
`plugin-presentation.mjs` strips such keys — a leaked `undefined` would be rejected
after the file was already written.

## Verification

`node scripts/presentation-proof.mjs` (from the kit root) renders both documents,
checks the self-containment rules, runs the negative controls (empty spec, unknown
slide type, missing title, empty donut, unknown theme) and drives the deck in
Chromium: console, keyboard, fragments, overview, notes, print media, and the same
deck inside `iframe sandbox="allow-scripts"`. Screenshots land in
`reports/presenter-proof/`.

## Not included on purpose

A filmstrip/comment panel, version history and a theme switcher stay out: the document
preview already presents the file, and a client half would add a browser bundle to
maintain before it adds anything the user cannot already do.
