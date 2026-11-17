/**
 * Panel styles. Colours come from the DSH theme aliases when the panel is mounted in
 * the shell, with neutral fallbacks so the same bundle renders correctly on the
 * static harness page. Spacing follows the 4/8 scale; two radii (6, 12); one focus
 * ring used everywhere.
 */
export const CSS = `
.dmv {
  --dmv-surface: var(--dsw-alias-bg-base, #ffffff);
  --dmv-surface-2: var(--dsw-alias-bg-layer-1, #f8fafc);
  --dmv-surface-3: var(--dsw-alias-bg-layer-2, #eef2f7);
  --dmv-ink: var(--dsw-alias-label-primary, #0f172a);
  --dmv-muted: var(--dsw-alias-label-secondary, #64748b);
  --dmv-line: var(--dsw-alias-border-l1, #e2e8f0);
  /* The primary button's FILL is the shell's primary-button fill, not its brand text
     colour: in the dark theme brand-primary is near-white, so using it as a fill made a
     white button whose white label disappeared. The label follows the inverted token and
     the panel re-derives it from the resolved fill as a fallback. */
  --dmv-accent: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #2563eb));
  --dmv-accent-ink: var(--dsw-alias-label-primary-inverted, #ffffff);
  --dmv-warn: var(--dsw-alias-state-warn-primary, #92400e);
  --dmv-danger: var(--dsw-alias-state-error-primary, #b91c1c);
  --dmv-ok: var(--dsw-alias-state-success-primary, #15803d);
  --dmv-radius-s: 6px;
  --dmv-radius-l: 12px;
  --dmv-focus: 2px solid var(--dmv-accent);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--dmv-surface);
  color: var(--dmv-ink);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.dmv * { box-sizing: border-box; }
.dmv :focus-visible { outline: var(--dmv-focus); outline-offset: 2px; border-radius: 4px; }

.dmv-top {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--dmv-line);
  background: var(--dmv-surface);
  min-height: 52px;
  flex-wrap: wrap;
}
.dmv-ident { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.dmv-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; margin: 0; white-space: nowrap; }
.dmv-view-title { font-size: 13px; font-weight: 550; color: var(--dmv-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40ch; }
.dmv-view-title::before { content: "/"; color: var(--dmv-muted); margin-right: 8px; font-weight: 400; }
.dmv-chips { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dmv-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--dmv-line);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--dmv-muted);
  background: var(--dmv-surface-2);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.dmv-chip.level { color: var(--dmv-ink); font-weight: 600; }
.dmv-chip.editing { color: var(--dmv-accent); border-color: color-mix(in srgb, var(--dmv-accent) 40%, var(--dmv-line)); background: color-mix(in srgb, var(--dmv-accent) 8%, var(--dmv-surface)); font-weight: 600; }
.dmv-chip.pending { color: var(--dmv-warn); border-color: color-mix(in srgb, var(--dmv-warn) 35%, var(--dmv-line)); }
.dmv-chip.lint { color: var(--dmv-warn); border-color: color-mix(in srgb, var(--dmv-warn) 40%, var(--dmv-line)); background: color-mix(in srgb, var(--dmv-warn) 8%, var(--dmv-surface)); font-weight: 600; }
.dmv-chip.lint.bad { color: var(--dmv-danger); border-color: color-mix(in srgb, var(--dmv-danger) 40%, var(--dmv-line)); background: color-mix(in srgb, var(--dmv-danger) 8%, var(--dmv-surface)); }
.dmv-chip.stale { color: var(--dmv-warn); border-color: color-mix(in srgb, var(--dmv-warn) 40%, var(--dmv-line)); background: color-mix(in srgb, var(--dmv-warn) 8%, var(--dmv-surface)); font-weight: 600; }
.dmv-chip.readonly { color: var(--dmv-ok); border-color: color-mix(in srgb, var(--dmv-ok) 35%, var(--dmv-line)); background: color-mix(in srgb, var(--dmv-ok) 7%, var(--dmv-surface)); }
.dmv-spacer { flex: 1 1 24px; }
.dmv-viewswitch select {
  border: 1px solid var(--dmv-line);
  border-radius: var(--dmv-radius-s);
  background: var(--dmv-surface-2);
  color: var(--dmv-ink);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  padding: 3px 8px;
  max-width: 26ch;
  cursor: pointer;
}
.dmv-viewswitch select:hover { background: var(--dmv-surface-3); }
.dmv-actions { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.dmv-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  border: 1px solid var(--dmv-line);
  border-radius: var(--dmv-radius-s);
  background: var(--dmv-surface-2);
  color: var(--dmv-ink);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  padding: 0 9px;
  cursor: pointer;
  white-space: nowrap;
}
.dmv-btn:hover { background: var(--dmv-surface-3); }
.dmv-btn.primary { background: var(--dmv-accent); border-color: var(--dmv-accent); color: var(--dmv-accent-ink, #ffffff); }
.dmv-btn svg { flex: none; }
.dmv-btn.primary:hover { filter: brightness(1.06); }
.dmv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dmv-selected .dmv-node { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dmv-accent) 45%, transparent); }
.dmv-edited {
  position: absolute;
  bottom: -7px;
  left: 6px;
  border: 1px solid color-mix(in srgb, var(--dmv-accent) 35%, var(--dmv-line));
  background: var(--dmv-surface);
  color: var(--dmv-accent);
  border-radius: 999px;
  padding: 0 4px;
  font-size: 8.5px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.dmv-search { position: relative; display: flex; align-items: center; gap: 4px; }
.dmv-search-input {
  width: min(260px, 34vw);
  height: 30px;
  border: 1px solid var(--dmv-line);
  border-radius: var(--dmv-radius-s);
  background: var(--dmv-surface-2);
  color: var(--dmv-ink);
  font: inherit;
  font-size: 12px;
  padding: 0 28px 0 9px;
}
.dmv-search-input::placeholder { color: var(--dmv-muted); opacity: 1; }
.dmv-search-count { position: absolute; right: 7px; font-size: 10px; color: var(--dmv-muted); font-variant-numeric: tabular-nums; pointer-events: none; }
.dmv-visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.dmv-crumbs {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px;
  border-bottom: 1px solid var(--dmv-line);
  background: var(--dmv-surface-2);
  font-size: 11.5px;
  min-height: 32px;
  overflow-x: auto;
}
.dmv-crumb-list { display: flex; align-items: center; gap: 4px; list-style: none; margin: 0; padding: 0; }
.dmv-crumb-list li { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dmv-crumb-list li + li::before { content: "/"; color: var(--dmv-muted); margin: 0 2px; }
.dmv-crumb {
  border: 1px solid transparent;
  background: transparent;
  color: var(--dmv-muted);
  font: inherit;
  font-weight: 550;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.dmv-crumb:hover { color: var(--dmv-ink); background: var(--dmv-surface-3); }
.dmv-crumb[aria-current="page"] { color: var(--dmv-ink); background: var(--dmv-surface); border-color: var(--dmv-line); cursor: default; font-weight: 650; }
.dmv-crumb-hint { color: var(--dmv-muted); font-size: 10.5px; }

.dmv-stage { flex: 1; min-height: 0; display: flex; background: var(--dmv-surface); position: relative; }
.dmv-flow { position: relative; flex: 1; min-width: 0; }
.dmv-flow .react-flow { background: var(--dmv-surface); }
/* RF puts the edge-label portal before the node layer; labels are annotations and must
   stay readable when core's labelAt is close to a box. */
.dmv-flow .react-flow__edgelabel-renderer { z-index: 5; }
/* React Flow ships light chrome. Every surface here inherits the host theme, so the
   controls and the minimap frame stop reading as white stickers on a dark page. */
.dmv-flow .react-flow__controls { border: 1px solid var(--dmv-line); border-radius: 8px; overflow: hidden; box-shadow: none; }
.dmv-flow .react-flow__controls-button {
  background: var(--dmv-surface-2);
  border-bottom: 1px solid var(--dmv-line);
  color: var(--dmv-ink);
  fill: currentColor;
}
.dmv-flow .react-flow__controls-button:hover { background: var(--dmv-surface-3); }
.dmv-flow .react-flow__controls-button svg { fill: currentColor; }
.dmv-flow .react-flow__minimap { background: var(--dmv-surface-2); }
.dmv-flow .react-flow__minimap-mask { fill: var(--dmv-surface-3); opacity: 0.45; }
.dmv-flow .react-flow__minimap { border: 1px solid var(--dmv-line); border-radius: 8px; overflow: hidden; }
@media (max-width: 760px) {
  .dmv-legend { display: none; }
}
.dmv-stage .react-flow__attribution { font-size: 9px; opacity: 0.55; }
/* The Excalidraw frame fills the stage; it draws and edits, the panel owns the chrome. */
.dmv-excalidraw { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
.dmv-stage .react-flow__node { border-radius: var(--dmv-radius-s); }
.dmv-stage .react-flow__node:focus-visible { outline: var(--dmv-focus); outline-offset: 2px; }
.dmv-stage .react-flow__handle { opacity: 0; pointer-events: none; }

/* Scene node: geometry (width/height/position) comes from the scene and React Flow. */
.dmv-node {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 10px;
  border: 1.5px solid;
  border-radius: 8px;
  color: #0f172a;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.25;
  text-align: center;
  white-space: pre-line;
  cursor: pointer;
  position: relative;
  transition: box-shadow 150ms ease-out, filter 150ms ease-out;
}
.dmv-node:hover, .dmv-node:focus-visible { box-shadow: 0 0 0 2px color-mix(in srgb, var(--dmv-accent) 40%, transparent); }
.dmv-node.shape-ellipse { border-radius: 50%; }
.dmv-node.shape-dashed { border-style: dashed; }
.dmv-node .dmv-node-label { overflow-wrap: anywhere; }
.dmv-node .dmv-open-hint { position: absolute; top: 2px; right: 4px; font-size: 10px; color: var(--dmv-muted); opacity: 0; }
.dmv-node:hover .dmv-open-hint, .dmv-node:focus-within .dmv-open-hint { opacity: 1; }
/* SceneCanvas has no header or legend; it fills the host panel's own box. */
.dmv-canvas-only { min-height: 0; }
.dmv-canvas-only .dmv-stage { min-height: 0; }
.dmv-node .dmv-stale {
  position: absolute;
  top: -7px;
  right: -4px;
  border: 1px solid color-mix(in srgb, var(--dmv-warn) 45%, #ffffff);
  background: #fff7ed;
  color: var(--dmv-warn);
  border-radius: 999px;
  padding: 0 3px;
  font-size: 8.5px;
  font-weight: 700;
  line-height: 1.5;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

/* Group band: scene geometry only; the title button is the keyboard drill affordance. */
.dmv-group {
  position: absolute;
  border: 1px dashed color-mix(in srgb, var(--dmv-accent) 30%, var(--dmv-line));
  border-radius: var(--dmv-radius-l);
  background: color-mix(in srgb, var(--dmv-accent) 3.5%, transparent);
  pointer-events: none;
}
.dmv-group-title {
  position: absolute;
  top: 0;
  left: 8px;
  transform: translateY(-50%);
  border: 1px solid color-mix(in srgb, var(--dmv-accent) 28%, var(--dmv-line));
  background: var(--dmv-surface);
  color: var(--dmv-muted);
  border-radius: 999px;
  padding: 0 7px;
  font: inherit;
  font-size: 10px;
  font-weight: 650;
  line-height: 1.7;
  cursor: pointer;
  white-space: nowrap;
}
.dmv-group-title { pointer-events: auto; }
.dmv-group-title:hover { color: var(--dmv-ink); border-color: var(--dmv-accent); }

.dmv-legend {
  flex: none;
  width: 188px;
  overflow: auto;
  border-left: 1px solid var(--dmv-line);
  background: var(--dmv-surface-2);
  padding: 12px;
  font-size: 10.5px;
  color: var(--dmv-muted);
}
.dmv-legend h2 { margin: 0 0 5px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--dmv-muted); font-weight: 700; }
.dmv-legend ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.dmv-legend li { display: flex; align-items: center; gap: 6px; }
.dmv-legend .swatch { width: 10px; height: 10px; border-radius: 3px; border: 1.5px solid; flex: none; }
.dmv-legend .swatch.ellipse { border-radius: 50%; }
.dmv-legend .swatch.dashed { border-style: dashed; }
.dmv-legend .line { width: 16px; border-top: 2px solid #475569; flex: none; }
.dmv-legend .hint { margin-top: 6px; padding-top: 5px; border-top: 1px solid var(--dmv-line); font-size: 9.5px; line-height: 1.4; }

/* The legend is a bar under the canvas, not a side rail: a wide map needs every pixel of
   width, and the legend is a reading aid for the same map, not a separate column. */
.dmv-legend-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 5px 12px;
  border-top: 1px solid var(--dmv-line);
  background: var(--dmv-surface-2);
  overflow-x: auto;
  font-size: 10.5px;
  color: var(--dmv-muted);
}
.dmv-legend-title { text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; font-size: 9.5px; color: var(--dmv-muted); }
.dmv-legend-group { display: flex; align-items: center; gap: 10px; margin: 0; padding: 0; list-style: none; }
.dmv-legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.dmv-labels { flex: none; display: flex; flex-direction: column; max-height: 220px; border-top: 1px solid var(--dmv-line); background: var(--dmv-surface); }
.dmv-labels-head { display: flex; align-items: baseline; gap: 10px; padding: 7px 16px 3px; flex-wrap: wrap; }
.dmv-labels-head h2 { margin: 0; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--dmv-muted); }
.dmv-labels-head p { margin: 0; font-size: 11px; color: var(--dmv-muted); }
.dmv-labels-count { margin-left: auto; font-size: 10.5px; color: var(--dmv-muted); font-variant-numeric: tabular-nums; }
.dmv-labels-list { list-style: none; margin: 0; padding: 4px 16px 10px; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 4px 14px; }
.dmv-label-row { display: grid; grid-template-columns: 34px minmax(80px, 1fr) 1.3fr; align-items: center; gap: 6px; min-width: 0; }
.dmv-label-kind { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; color: var(--dmv-muted); }
.dmv-label-id { font-size: 10.5px; color: var(--dmv-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dmv-label-input { min-width: 0; height: 25px; border: 1px solid var(--dmv-line); border-radius: 4px; padding: 0 6px; background: var(--dmv-surface-2); color: var(--dmv-ink); font: inherit; font-size: 11.5px; }
.dmv-label-input:focus-visible { outline: 2px solid var(--dmv-accent); outline-offset: 1px; }
.dmv-legend-mixed {
  display: inline-flex;
  align-items: center;
  border: 1px dashed var(--dmv-line);
  border-radius: 999px;
  padding: 0 5px;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--dmv-muted);
  background: var(--dmv-surface-2);
}
.dmv-legend-item b { font-weight: 650; color: var(--dmv-ink); font-variant-numeric: tabular-nums; }
.dmv-glyph { width: 11px; height: 11px; border-radius: 3px; border: 1.5px solid; display: inline-block; flex: none; }
.dmv-glyph.ellipse { border-radius: 50%; }
.dmv-glyph.dashed { border-style: dashed; }
.dmv-glyph.diamond { transform: rotate(45deg); border-radius: 2px; }
.dmv-wire { width: 18px; border-top: 2px solid; display: inline-block; flex: none; }
.dmv-legend-sep { width: 1px; height: 14px; background: var(--dmv-line); flex: none; }
.dmv-legend-hint { font-size: 10px; color: var(--dmv-muted); }
.dmv-fit { font-size: 10.5px; padding: 2px 8px; }
.dmv-inspector-pop {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 220px;
  max-height: 60%;
  overflow: auto;
  background: var(--dmv-surface);
  border: 1px solid var(--dmv-line);
  border-radius: var(--dmv-radius-l);
  padding: 10px 12px;
  box-shadow: 0 8px 24px rgb(15 23 42 / 0.14);
  z-index: 6;
}
.dmv-inspector { margin-top: 10px; padding-top: 9px; border-top: 1px solid var(--dmv-line); }
.dmv-inspector h2 { margin: 0 0 5px; font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--dmv-muted); font-weight: 700; }
.dmv-inspector-name { margin: 0 0 2px; color: var(--dmv-ink); font-weight: 650; font-size: 11.5px; overflow-wrap: anywhere; }
.dmv-inspector-name code { font: 9.5px/1.4 ui-monospace, monospace; color: var(--dmv-muted); display: block; }
.dmv-inspector-hint { margin: 0 0 7px; font-size: 10px; color: var(--dmv-muted); }
.dmv-swatches { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.dmv-swatch-btn { width: 24px; height: 24px; border: 2px solid; border-radius: 6px; cursor: pointer; padding: 0; }
.dmv-swatch-btn[aria-pressed="true"] { outline: 2px solid var(--dmv-accent); outline-offset: 1px; }
.dmv-inspector-actions { display: flex; flex-wrap: wrap; gap: 4px; }

.dmv-edge-label {
  position: absolute;
  transform-origin: top left;
  /* The plate must be opaque: a translucent one let the edge line and any node
     underneath show through the glyphs, which is unreadable on a dark theme.
     Width/height come inline from the scene's labelBox — the same rectangle core
     validated — so the fallback never draws a bigger label than the check approved. */
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: var(--dmv-surface);
  border: 1px solid var(--dmv-line);
  border-radius: 6px;
  padding: 0 2px;
  font-size: 10.5px;
  line-height: 1.25;
  font-weight: 600;
  color: var(--dmv-ink);
  white-space: pre-line;
  overflow: hidden;
  pointer-events: none;
}

.dmv-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  padding: 32px;
  color: var(--dmv-muted);
}
.dmv-empty h2 { margin: 0; font-size: 15px; color: var(--dmv-ink); font-weight: 650; }
.dmv-empty p { margin: 0; max-width: 52ch; }

.dmv-status {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 16px;
  border-top: 1px solid var(--dmv-line);
  background: var(--dmv-surface);
  font-size: 11px;
  min-height: 28px;
  color: var(--dmv-muted);
}
.dmv-status[data-kind="ok"] { color: var(--dmv-ok); }
.dmv-status[data-kind="error"] { color: var(--dmv-danger); }
.dmv-status code { font: 10.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.dmv-status .dmv-spacer { flex: 1; }

.dmv-foot {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  padding: 8px 16px;
  border-top: 1px solid var(--dmv-line);
  background: var(--dmv-surface-2);
  font-size: 10.5px;
  color: var(--dmv-muted);
  font-variant-numeric: tabular-nums;
}
.dmv-foot dl { display: contents; margin: 0; }
.dmv-foot .pair { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dmv-foot dt { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; color: var(--dmv-muted); }
.dmv-foot dd { margin: 0; color: var(--dmv-ink); font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 46ch; }
.dmv-foot dd code { font: inherit; }
.dmv-foot .warn dd { color: var(--dmv-warn); }

.dmv-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary, #0f172a);
  border-radius: 6px;
  padding: 3px 7px;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  height: 26px;
}
.dmv-trigger:hover { background: var(--dsw-alias-bg-layer-1, #f1f5f9); }
.dmv-trigger:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #2563eb); outline-offset: 2px; }
.dmv-loading { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--dmv-muted); gap: 8px; }
.dmv-loading .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--dmv-accent); animation: dmv-pulse 1.2s ease-in-out infinite; }
.dmv-error { flex: 1; display: flex; align-items: center; justify-content: center; padding: 32px; color: var(--dmv-danger); text-align: center; }
@keyframes dmv-pulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dmv-loading .pulse { animation: none; } .dmv-node { transition: none; } }
`
