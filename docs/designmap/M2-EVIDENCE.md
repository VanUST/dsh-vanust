> **Историческая запись (design-map v1).** v1 удалён в P3 2026-11-24: файлы модели, сцена-контракт и семь инструментов `designmap_*` больше не существуют; имена ниже — история, не инструкция. Актуальное описание — `docs/DESIGNMAP-V2.md`.

# M2 evidence — editable overlay layer

Product-run evidence for the M2 slice of the designmap panel: an explicit
read-only → edit toggle, node drag/recolour into `designmap/overlays.json`, per-node
and per-view reset, undo, and a write path through the host that never touches
`model.yaml` or `out/`.

Environment: node v24.20.0, `@xyflow/react` 12.12.1, React 18.3.1, esbuild 0.25.12,
real DSH client-module loader in Chromium 1254 (`playwright-core` 1.65, axe-core
4.14.0). Commands run from `/home/iustimov/dsh-kit/plugins/designmap` unless stated.
Screenshots are in [`screenshots/`](screenshots/).

## 1. Test suite and command path (exit 0)

BACKEND's transport fix landed while M2 was in progress; `src/command.mjs` now strips
the dispatch key `op` before the domain guard. The full plugin suite is green:

```text
$ node --test test/*.test.mjs
ℹ tests 93
ℹ pass 93
ℹ fail 0
[exit 0]

$ node --test test/host-command.test.mjs
✔ the overlay op forwards only visual fields; the domain guard still refuses model fields
ℹ pass 3
ℹ fail 0
[exit 0]
```

The M2 client bundle was rebuilt from `client/view.jsx`, `client/host.js` and
`client/styles.js`:

```text
$ node build-client.mjs
client.js 468.0 KiB (CJS body 467.8 KiB)
[exit 0]
$ sha256sum client.js
43f2ce56fae06d18dc9c6c0d4adf8d225ef277230db6310e982c730997bb1a6f  client.js
```

## 2. Browser harness

`node harness/serve.mjs` serves `http://127.0.0.1:4320/?set=m2`. The M2 set is a
writable copy of `fixtures/demo` under `harness/workspace/designmap`; the harness's
fake remote sends `/designmap <json>` into the **real** `createCommandHandler` +
`createHostService` on that directory, so the browser exercises the same command,
guard, logger and file writer as the panel in DSH. It is not a stub writer.

The demo was re-rendered after BACKEND's geometry fix. The harness workspace scenes
carry the new geometry (`m0` renders are pinned at
`sha256:3ec7cf040db5ee668a87e436a825249fa597e2757839c622c884e688f5207ec4`).

States captured: `m2-readonly.png`, `m2-edit-mode.png`, `m2-selected-node.png`,
`m2-after-drag.png`, `m2-after-colour.png`, `m2-regenerated.png`,
`m2-reset-node.png`, `m2-undo.png`, `m2-reset-view.png`, `m2-final.png`,
`m2-keyboard-audit.png`.

## 3. Read-only is the default; a drag there writes nothing

On load: `data-edit-mode="false"`, `aria-pressed="false"`, chip `read-only`,
`lastWrite:null`. A mouse drag over `ext.stripe` in that state left both the DOM
position and the file unchanged:

```text
editMode:false pending:0 position:{x:726.61,y:102.07}
before === after: true
```

The edit control is only rendered when the host exposes a write command
(`host.canWrite`); the read-only fixture and M0 sets show no `Edit overlays` button.

## 4. One overlay row delta after the 500 ms debounce

Starting from

```json
{
  "$version": 1,
  "db.orders": { "x": 620, "y": 36 }
}
```

selecting `ext.stripe` and dragging it produced, **immediately after mouse-up**:

```text
pending:1
overlays:{ "db.orders":{"x":620,"y":36} }      # file still unchanged
position: {"x":726.61,"y":102.07}              # local state only
```

and after 900 ms:

```json
{
  "$version": 1,
  "db.orders": { "x": 620, "y": 36 },
  "ext.stripe": { "x": 726.61, "y": 102.07 }
}
```

The panel sent exactly one command and the host logged exactly one write:

```text
/designmap {"op":"overlay","action":"upsert","nodeId":"ext.stripe","x":726.61,"y":102.07}
{"event":"overlay.write","action":"upsert","nodeId":"ext.stripe","keys":["x","y"],"rows":3}
```

Colour is the same debounced path: `Use service colours` added only
`fill:"#e0e7ff", stroke:"#4338ca"` to the existing row; the file was unchanged
immediately after the click and updated after 500 ms. It emitted
`colorChanged {nodeId:"ext.stripe", fill:"#e0e7ff", stroke:"#4338ca"}`. The row is
strictly `x/y/fill/stroke`; no label, type or model field is in it.

## 5. A regenerated scene keeps the human's position and colour

`Regenerate scene` calls the real `/designmap {op:'render'}`; the panel then reloads
scenes and overlays. The scene node is now:

```json
{"id":"ext.stripe","type":"external","label":"Stripe","x":726.61,"y":102.07,"w":140,"h":44,"stale":false}
```

The node still receives `fill:#e0e7ff` / `stroke:#4338ca` from the overlay row because
the renderer merges overlays by **semantic node id** (`ext.stripe`), not by label or
position. Computed style after regeneration: `background: rgb(224, 231, 255)`,
`border: rgb(67, 56, 202)`; footer scene hash changed to
`sha256:19cddd544894…` and still reports `Overlays 2 nodes · saved`.

## 6. Reset node / reset view remove only their rows

Reset node for `ext.stripe` removed its row and re-rendered the layout position:

```json
{ "$version": 1, "db.orders": { "x": 620, "y": 36 } }
```

```json
{"id":"ext.stripe","x":700.6,"y":96}     // scene after render
```

Host log: `{"event":"overlay.write","action":"resetNode","nodeId":"ext.stripe","rows":2}`.

Reset view on `v.context` removed **both** rows of that view (the demo's `db.orders`
included) and re-rendered:

```json
{ "$version": 1 }
```

```text
v.context scene: svc.checkout.api x:24 y:44.33     # overlay move gone
```

Host log: `{"event":"overlay.write","action":"resetView","viewId":"v.context","removed":2,"rows":1}`.

## 7. Undo restores the previous visual state exactly

After undo of reset node, the removed row returned **with all four fields**, and the
scene moved back:

```json
"ext.stripe": { "x": 726.61, "y": 102.07, "fill": "#e0e7ff", "stroke": "#4338ca" }
```

```json
{"id":"ext.stripe","x":726.61,"y":102.07}
```

After reset view, undo restored both rows; the browser's command list shows the exact
inverse path:

```text
/designmap {"op":"overlay","action":"replace","nodeId":"db.orders","row":{"x":620,"y":36}}
/designmap {"op":"overlay","action":"replace","nodeId":"ext.stripe","row":{"x":726.61,"y":102.07,"fill":"#e0e7ff","stroke":"#4338ca"}}
/designmap {"op":"render"}
```

Undo of an earlier drag (made through the real command handler after removing the
temporary harness shim) also returned `x:726.61,y:102.07` from `735.55,105.65`, with
`overlay.write replace` followed by `render`. The undo stack is in-memory per panel
mount; it is not persisted, and a reload starts with no undo history.

## 8. Model fields are refused before and at the host

From the panel, `window.__M2__.attemptModelWrite()` (an `upsert` carrying `label`)
is refused client-side with a named error; the file hash is unchanged:

```json
{"ok":false,"error":{"code":"model_fields_forbidden","message":"The panel can only write overlays (x/y/fill/stroke); label belongs to the model."}}
```

Forged at the host boundary, the same field is also refused, though at a different
layer: BACKEND's transport forwards only the visual-field allow-list, so a payload
that carries only `label` reaches the service as an empty upsert and is rejected:

```text
$ curl -s -X POST http://127.0.0.1:4320/stub/command \
  -H 'content-type: application/json' \
  -d '{"line":"/designmap {\"op\":\"overlay\",\"action\":\"upsert\",\"nodeId\":\"ext.stripe\",\"label\":\"illegal\"}"}'
{"ok":true,"value":{"result":{"kind":"error","text":"designmap: invalid_overlay: overlay upsert needs at least one of x/y/fill/stroke"}}}
```

The transport-drop is deliberate (unknown keys never become a write); the service's
strict domain guard is the second line and is covered by
`host-command.test.mjs` ("the overlay op forwards only visual fields; the domain
guard still refuses model fields"). The net result is the same: no label, type,
group or edge can be written from the panel, and `overlays.json` is unchanged by
the attempt. There is no UI control that sends a model field.

## 9. Overlay write touches only `overlays.json`

Hashes before and after one host overlay write (no render between them):

```text
$ curl … {"action":"upsert","nodeId":"ext.stripe","fill":"#dbeafe","stroke":"#2563eb"}
{"ok":true,…,"keys":["fill","stroke"],"rows":3,…}

before
3d433c64…  model.yaml
14727a71…  views.yaml
a5cf4d64…  overlays.json
4c9906b6…  out/index.json
19cddd54…  out/v.context.scene.json
a7f97739…  out/v.checkout.scene.json

after
3d433c64…  model.yaml                     unchanged
14727a71…  views.yaml                     unchanged
9a77e771…  overlays.json                  changed (temporary colour)
4c9906b6…  out/index.json                 unchanged
19cddd54…  out/v.context.scene.json       unchanged
a7f97739…  out/v.checkout.scene.json      unchanged
```

The temporary row was then restored to the final `#e0e7ff/#4338ca` values and
`render` run; `overlays.json` returned to `a5cf4d64…` and the scene to `19cddd54…`.

`render` is a separate explicit command; it changes `out/` and the index, never the
model. Overlay writes log to `logs/events.jsonl`, not into the model or scene files.

## 10. Accessibility and keyboard

axe-core 4.14.0, tags `wcag2a` + `wcag2aa`, real Chromium, `browser.newContext()`
first. Scanned read-only m0, read-only fixture, read-only M2 and edit M2 with a
selected node:

```text
m0            violations: []
fixture       violations: []
m2 read-only  violations: []
m2 edit       violations: []
```

Negative control (an icon-only button with an `aria-hidden` glyph injected into the
page) made the same scan report `button-name` / critical, so the scan is not vacuous.

Keyboard transcript (each stop had a visible outline or ring):

```text
Tab 1  BUTTON "Regenerate scene"        focusVisible true
Tab 2  LINK   "pinned fixture"          focusVisible true
Tab 3  LINK   "M0 demo render"          focusVisible true
Tab 4  LINK   "M2 editable workspace"   focusVisible true
Tab 5  LINK   "empty view"              focusVisible true
Tab 6  BUTTON "Edit overlays"           focusVisible true
Tab 7  INPUT  "Search nodes by label or id" focusVisible true
Tab 8  GROUP  "SQL / reads edge…"       focusVisible true
Tab 12 GROUP  "Orders DB…"              focusVisible true
```

`Enter` on `Edit overlays` set `editMode:true` / `aria-pressed:true`; `Enter` on the
focused `ext.stripe` node selected it and announced
`selected: Selected Stripe. Arrow keys nudge; pick a colour to recolour.`; Tab reached
the colour swatches; `Space` on `Use datastore colours` wrote
`fill:"#fef3c7", stroke:"#d97706"` after the debounce; two `ArrowRight` presses and
`Shift+ArrowDown` moved the selected node by `+16,+1` (to `742.61,103.07`) and wrote
one row. Every node/edge group, canvas control and inspector control is focusable and
has a visible ring.

Axe could not determine `color-contrast` for 37 elements (edge labels with arrow
backgrounds, nodes partially overlapped by other elements); these are `incomplete`,
not violations. It also reports React Flow's `.react-flow__controls` div carrying
`aria-label` without a role (`aria-prohibited-attr`, incomplete). No manual
screen-reader pass was run.

## 11. Read-only regression (M1)

With the M2 edit code present but no write capability, the original panel still
works: M0 context renders the regenerated `sha256:3ec7cf040db5…` scene, drills into
`Checkout internals` with a two-crumb trail, search `orders` reports
`match: Jumped to Orders DB`, and clicking `svc.checkout.api` on the fixture reports
`opened: Opened plugins/designmap/src/palette.mjs`. Console errors: none.

## 12. Skipped / unverified

- The live DSH Web GUI (`http://127.0.0.1:3080`) was not restarted or reloaded; M2 was
  proven on the kit's real client-module loader harness. A shell reload of the plugin
  is still the deployment step.
- No real screen-reader pass, no touch/mobile layout, no Firefox/WebKit.
- Drag is pointer-only for the mouse; the keyboard path is arrow-key nudge on the
  selected node, not a drag. Free-form dragging with a screen reader is not possible.
- Edge `labelAt` is core-owned. After a move, a short edge's label text can still
  overlap a node box even though the anchor is outside it (`reserve stock` over the
  worker in the demo). The renderer must not move it; this is a core label-extent
  finding, not an M2 patch.
- The host's `overlays.json` result reports `rows` including `$version` (e.g. `rows:3`
  for two overlay nodes). The writer is correct; only the informational count is
  off by one.

## 13. Decisions

- Edit mode is an explicit toggle and defaults off; the control renders only when
  `host.canWrite` is true.
- One debounce map per node (500 ms) merges a drag and a colour picked in quick
  succession into one row update; it flushes on toggle-off and before view changes.
- Undo uses the host `replace` action for an exact row snapshot (or `resetNode` when
  the previous row was absent), then re-renders and reloads so scene geometry follows.
- The renderer displays overlay `x/y` before the next render (so a reload does not
  visibly jump back); it still never computes layout.
- Local write guards mirror the host guard, so a model field is refused twice.
