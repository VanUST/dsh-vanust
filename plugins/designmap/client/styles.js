/**
 * Page-editor styles.
 *
 * Colours come from the DSH theme aliases when the panel is mounted in the shell, with neutral
 * fallbacks so the same bundle renders on the static harness page. The Project state panel
 * overrides the `--dmv-*` tokens with its own, so the editor and the panel around it share one
 * palette.
 *
 * The header is ONE row: the title, the page switch and the four actions. The stage takes every
 * other pixel, and the findings panel is the only thing that may take some back (it is capped at
 * a third of the editor). v1's stylesheet carried the React Flow scene, node cards and legend;
 * v2 renders none of those and the dead rules were removed with the scene contract.
 */
export const CSS = `
.dmv {
  --dmv-surface: var(--dsw-alias-bg-base, #ffffff);
  --dmv-surface-2: var(--dsw-alias-bg-layer-1, #f8fafc);
  --dmv-surface-3: var(--dsw-alias-bg-layer-2, #eef2f7);
  --dmv-ink: var(--dsw-alias-label-primary, #0f172a);
  --dmv-muted: var(--dsw-alias-label-secondary, #64748b);
  --dmv-line: var(--dsw-alias-border-l1, #e2e8f0);
  --dmv-accent: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #2563eb));
  --dmv-accent-ink: var(--dsw-alias-label-primary-inverted, #ffffff);
  --dmv-ok: var(--dsw-alias-state-success-primary, #15803d);
  --dmv-warn: var(--dsw-alias-state-warn-primary, #92400e);
  --dmv-danger: var(--dsw-alias-state-error-primary, #b91c1c);
  --dmv-radius: 6px;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--dmv-surface);
  color: var(--dmv-ink);
  font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  container-type: inline-size;
}
.dmv * { box-sizing: border-box; }
.dmv :focus-visible { outline: 2px solid var(--dmv-accent); outline-offset: 2px; border-radius: 4px; }

.dmv-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: 42px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dmv-line);
  background: var(--dmv-surface);
}
.dmv-title { margin: 0 4px 0 0; font-size: 13px; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; }
.dmv-page { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dmv-label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--dmv-muted); font-weight: 700; white-space: nowrap; }
.dmv-select {
  height: 26px;
  max-width: 26ch;
  border: 1px solid var(--dmv-line);
  border-radius: var(--dmv-radius);
  background: var(--dmv-surface-2);
  color: var(--dmv-ink);
  font: inherit;
  font-size: 11.5px;
  font-weight: 550;
  padding: 0 6px;
  cursor: pointer;
}
.dmv-select:hover { background: var(--dmv-surface-3); }
.dmv-select:disabled { opacity: .55; cursor: default; }

.dmv-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  border: 1px solid var(--dmv-line);
  border-radius: var(--dmv-radius);
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
.dmv-btn[aria-pressed="true"] { background: color-mix(in srgb, var(--dmv-accent) 14%, var(--dmv-surface-2)); border-color: color-mix(in srgb, var(--dmv-accent) 45%, var(--dmv-line)); }
.dmv-btn.small { height: 22px; font-size: 11px; padding: 0 7px; }
.dmv-btn:disabled { opacity: .5; cursor: not-allowed; }

.dmv-chip {
  display: inline-flex;
  align-items: center;
  height: 24px;
  border-radius: 999px;
  padding: 0 9px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  border: 1px solid var(--dmv-line);
  background: var(--dmv-surface-2);
  color: var(--dmv-muted);
}
.dmv-chip.ok { color: var(--dmv-ok); border-color: color-mix(in srgb, var(--dmv-ok) 40%, var(--dmv-line)); background: color-mix(in srgb, var(--dmv-ok) 9%, var(--dmv-surface)); }
.dmv-chip.warn { color: var(--dmv-warn); border-color: color-mix(in srgb, var(--dmv-warn) 45%, var(--dmv-line)); background: color-mix(in srgb, var(--dmv-warn) 10%, var(--dmv-surface)); }
.dmv-chip.bad { color: var(--dmv-danger); border-color: color-mix(in srgb, var(--dmv-danger) 45%, var(--dmv-line)); background: color-mix(in srgb, var(--dmv-danger) 10%, var(--dmv-surface)); }

.dmv-spacer { flex: 1 1 auto; }
.dmv-status {
  min-width: 0;
  max-width: 44ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--dmv-muted);
  font-variant-numeric: tabular-nums;
}
.dmv-status[data-kind="ok"] { color: var(--dmv-ok); }
.dmv-status[data-kind="error"] { color: var(--dmv-danger); }

.dmv-stage { position: relative; flex: 1 1 auto; min-height: 0; background: #ffffff; }
.dmv-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; }

.dmv-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--dmv-muted); }
.dmv-loading .pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--dmv-accent); animation: dmv-pulse 1.2s ease-in-out infinite; }
@keyframes dmv-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .dmv-loading .pulse { animation: none; } }

.dmv-lint {
  flex: none;
  max-height: 34vh;
  overflow: auto;
  border-top: 1px solid var(--dmv-line);
  background: var(--dmv-surface-2);
  padding: 8px 10px 10px;
  scrollbar-width: thin;
}
.dmv-lint-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 0 0 6px; }
.dmv-lint-head h2 { margin: 0; font-size: 12px; font-weight: 700; }
.dmv-lint-head span { font-size: 10.5px; color: var(--dmv-muted); font-variant-numeric: tabular-nums; }
.dmv-lint ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 6px; }
.dmv-finding { border: 1px solid var(--dmv-line); border-left: 3px solid var(--dmv-line); background: var(--dmv-surface); border-radius: var(--dmv-radius); padding: 5px 8px; min-width: 0; }
.dmv-finding.high { border-left-color: var(--dmv-danger); }
.dmv-finding.medium { border-left-color: var(--dmv-warn); }
.dmv-finding.low { border-left-color: var(--dmv-muted); }
.dmv-finding-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dmv-finding-head code { font: 10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; white-space: nowrap; }
.dmv-finding-elements { flex: 1 1 auto; min-width: 0; font: 10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--dmv-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dmv-finding p { margin: 2px 0 0; font-size: 11px; color: var(--dmv-muted); overflow-wrap: anywhere; }
.dmv-more { margin: 6px 0 0; font-size: 11px; color: var(--dmv-muted); }

/* Full screen: the editor IS the screen; the toolbar stays so the page switch and Exit exist. */
.dmv:fullscreen { width: 100vw; height: 100vh; background: var(--dmv-surface); }
.dmv:fullscreen .dmv-stage { background: #ffffff; }

@container (max-width: 720px) {
  .dmv-title { display: none; }
  .dmv-status { max-width: 20ch; }
  .dmv-lint ul { grid-template-columns: minmax(0, 1fr); }
}
`
