/* @cc/dsh-project-state-panel — the read-only Project state panel.
 *
 * One panel, four modes over ONE selection:
 *   Requirements   the REQ registry with criteria and its gaps
 *   Board          TASK grouped by status, filtered by the selected REQ
 *   Design map     the designmap scene, drawn by the existing React Flow renderer
 *   Tests & trace  TEST rows and the REQ x TASK/TEST/DECISION matrix
 *
 * Data: `state/views/index.json` is the link contract. The entity files under
 * `state/req|task|test|decision/` are read only for the fields index.json does not carry
 * (title, criteria, body, command, revision); the panel never parses a markdown projection.
 * The map-to-requirement link comes from the analysis records (`docs/analysis/*.json`,
 * `trace[].componentId`), because index.json carries no map link; the matcher is exact id,
 * dotted suffix, then `node.id = <componentId>`.
 *
 * Writes: NONE. No command except designmap's read-only `views` op is executed, and no
 * file is written. The panel says so in its own header.
 */
window.__ModuleLoader__.load({
  id: '@cc/dsh-project-state-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React
    const designmap = require('@cc/dsh-designmap')
    const SceneCanvas = designmap !== null && typeof designmap === 'object' ? designmap.SceneCanvas : undefined

    const PANEL_ID = 'project-state'
    const SESSION_KEY = 'dsh:project-state-panel:session'
    const INDEX_PATH = 'state/views/index.json'
    const ANALYSIS_DIR = 'docs/analysis'
    const KIND_DIR = { req: 'req', task: 'task', test: 'test', decision: 'decision' }
    const KIND_LABEL = { req: 'REQ', task: 'TASK', test: 'TEST', decision: 'DEC', evidence: 'EVIDENCE', node: 'NODE' }
    const KIND_NAME = { req: 'Requirement', task: 'Task', test: 'Test', decision: 'Decision', evidence: 'Evidence', node: 'Map node' }
    // The prototype's entity grammar: one colour per type, used only as the chip marker and
    // as a tint; the text stays the theme's ink so contrast does not depend on the type.
    const TYPE_COLOR = { req: '#FFB020', task: '#38BDF8', test: '#A3E635', decision: '#E879F9', evidence: '#22D3EE', node: '#94A3B8' }
    const TASK_COLUMNS = [
      { id: 'open', label: 'Open', statuses: ['open'] },
      { id: 'active', label: 'Active', statuses: ['active'] },
      { id: 'review', label: 'Review', statuses: ['review'] },
      { id: 'blocked', label: 'Blocked', statuses: ['blocked'] },
      { id: 'done', label: 'Done', statuses: ['done', 'cancelled'] },
    ]

    const CSS = `
.ps-root {
  /* The panel owns no palette of its own: every surface, label, border and state colour is
     a shell alias token, so the same rules follow the light and the dark theme. Entity
     accents (TYPE_COLOR: REQ/TASK/TEST/DEC) stay semantic and are deliberately not themed.
     State colours are mixed with the theme ink so a saturated token keeps a readable text
     contrast on both backgrounds instead of being used raw. */
  --ps-paper: var(--dsw-alias-bg-base);
  --ps-surface: var(--dsw-alias-bg-layer-1);
  --ps-surface-2: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, var(--dsw-alias-bg-base));
  --ps-surface-3: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, var(--dsw-alias-bg-base));
  --ps-ink: var(--dsw-alias-label-primary);
  --ps-muted: var(--dsw-alias-label-secondary);
  --ps-line: var(--dsw-alias-border-l1);
  --ps-line-strong: var(--dsw-alias-border-l2);
  --ps-accent: var(--dsw-alias-brand-primary);
  --ps-accent-hover: var(--dsw-alias-button-primary-hover);
  --ps-accent-ink: var(--dsw-alias-label-primary-inverted);
  --ps-ok: color-mix(in srgb, var(--dsw-alias-state-success-primary) 62%, var(--dsw-alias-label-primary));
  --ps-warn: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 50%, var(--dsw-alias-label-primary));
  --ps-bad: color-mix(in srgb, var(--dsw-alias-state-error-primary) 78%, var(--dsw-alias-label-primary));
  --ps-info: color-mix(in srgb, var(--dsw-alias-state-business-primary) 68%, var(--dsw-alias-label-primary));
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--ps-paper);
  color: var(--ps-ink);
  font: 13.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  container-type: inline-size;
}
.ps-root * { box-sizing: border-box; }
.ps-root :focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; border-radius: 4px; }
.ps-top { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--ps-line); flex: none; flex-wrap: wrap; min-height: 48px; }
.ps-title { font-size: 16px; font-weight: 700; letter-spacing: -.01em; margin: 0; }
.ps-modebar { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border: 1px solid var(--ps-line); border-radius: 8px; background: var(--ps-surface-2); }
.ps-mode { border: 0; background: transparent; color: var(--ps-muted); border-radius: 6px; padding: 4px 9px; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; white-space: nowrap; }
.ps-mode[aria-selected="true"] { background: var(--ps-surface); color: var(--ps-ink); box-shadow: 0 0 0 1px var(--ps-line); }
.ps-mode:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-spacer { flex: 1; }
.ps-ro { display: inline-flex; align-items: center; gap: 5px; border: 1px solid color-mix(in srgb, var(--ps-ok) 38%, var(--ps-line)); background: color-mix(in srgb, var(--ps-ok) 8%, transparent); color: var(--ps-ok); border-radius: 999px; padding: 2px 8px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.ps-ro:before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ps-meta { color: var(--ps-muted); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ps-counts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ps-count { display: inline-flex; align-items: center; gap: 4px; color: var(--ps-muted); font-size: 11px; white-space: nowrap; }
.ps-count b { color: var(--ps-ink); font-variant-numeric: tabular-nums; }
.ps-btn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--ps-line); background: var(--ps-surface-2); color: var(--ps-ink); border-radius: 7px; padding: 4px 9px; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; white-space: nowrap; }
.ps-btn:hover { background: var(--ps-surface-3); }
.ps-btn:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-btn.small { min-height: 24px; padding: 3px 7px; font-size: 11px; font-weight: 600; }
.ps-btn.icon { min-width: 24px; min-height: 24px; padding: 3px 7px; font-size: 13px; line-height: 1.2; }
.ps-filterbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 14px; border-bottom: 1px solid var(--ps-line); background: color-mix(in srgb, var(--ps-accent) 6%, var(--ps-surface)); flex: none; font-size: 11.5px; }
.ps-filterbar b { font-weight: 700; }
.ps-filterbar .ps-gap { margin-left: 0; }
.ps-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.ps-body.with-drawer { grid-template-columns: minmax(0, 1fr) 390px; }
.ps-main { min-width: 0; min-height: 0; overflow: auto; padding: 12px 14px 28px; scrollbar-width: thin; }
.ps-drawer { border-left: 1px solid var(--ps-line); background: var(--ps-surface-2); min-height: 0; overflow: auto; padding: 12px 14px 28px; scrollbar-width: thin; }
@container (max-width: 760px) {
  .ps-body.with-drawer { grid-template-columns: minmax(0, 1fr); }
  .ps-drawer { border-left: 0; border-top: 1px solid var(--ps-line); max-height: 55vh; }
  .ps-top { align-items: flex-start; }
}
.ps-kicker { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ps-muted); font-weight: 700; margin: 0 0 3px; }
.ps-h2 { font-size: 14px; line-height: 1.3; margin: 0 0 6px; overflow-wrap: anywhere; }
.ps-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-height: 24px; border: 1px solid color-mix(in srgb, var(--ps-type) 55%, var(--ps-line)); background: color-mix(in srgb, var(--ps-type) 15%, var(--ps-surface)); color: var(--ps-ink); border-radius: 6px; padding: 3px 6px 3px 4px; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 650; cursor: pointer; }
.ps-chip .mark { width: 7px; height: 7px; flex: none; background: var(--ps-type); }
.ps-chip code { font: inherit; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-chip.static { cursor: default; }
.ps-chip:hover { background: color-mix(in srgb, var(--ps-type) 24%, var(--ps-surface)); }
.ps-chip:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-chip.evidence { border-style: dashed; }
.ps-status { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--ps-line); border-radius: 999px; padding: 1px 7px; font-size: 10.5px; font-weight: 650; color: var(--ps-muted); background: var(--ps-surface); white-space: nowrap; }
.ps-status.ok { color: var(--ps-ok); border-color: color-mix(in srgb, var(--ps-ok) 35%, var(--ps-line)); background: color-mix(in srgb, var(--ps-ok) 8%, transparent); }
.ps-status.bad { color: var(--ps-bad); border-color: color-mix(in srgb, var(--ps-bad) 35%, var(--ps-line)); background: color-mix(in srgb, var(--ps-bad) 8%, transparent); }
.ps-status.warn { color: var(--ps-warn); border-color: color-mix(in srgb, var(--ps-warn) 35%, var(--ps-line)); background: color-mix(in srgb, var(--ps-warn) 8%, transparent); }
.ps-status.info { color: var(--ps-accent); border-color: color-mix(in srgb, var(--ps-accent) 35%, var(--ps-line)); background: color-mix(in srgb, var(--ps-accent) 8%, transparent); }
.ps-gap { display: inline-flex; align-items: center; gap: 4px; min-height: 24px; border: 1px dashed color-mix(in srgb, var(--ps-warn) 55%, var(--ps-line)); background: color-mix(in srgb, var(--ps-warn) 6%, transparent); color: var(--ps-ink); border-radius: 6px; padding: 3px 6px; font: 11px/1.55 inherit; font-weight: 600; cursor: pointer; }
.ps-gap:before { content: "△"; color: var(--ps-warn); font-size: 10px; }
.ps-gap:hover { background: color-mix(in srgb, var(--ps-warn) 12%, transparent); }
.ps-gap.static { cursor: default; }
.ps-reqlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ps-reqrow { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--ps-line); background: var(--ps-surface-2); border-radius: 10px; padding: 9px 11px; }
.ps-reqrow.sel { border-color: var(--ps-accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ps-accent) 45%, transparent); background: color-mix(in srgb, var(--ps-accent) 5%, var(--ps-surface-2)); }
.ps-reqrow .body { flex: 1; min-width: 0; }
.ps-rowbtn { display: block; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 0; cursor: pointer; }
.ps-rowbtn:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 2px; border-radius: 4px; }
.ps-rowtitle { font-size: 13.5px; font-weight: 650; line-height: 1.35; overflow-wrap: anywhere; }
.ps-rowmeta { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
.ps-criteria { margin: 6px 0 0; padding: 0 0 0 18px; color: var(--ps-muted); font-size: 12px; }
.ps-criteria li { margin: 1px 0; }
.ps-board { display: flex; gap: 8px; align-items: flex-start; overflow-x: auto; padding-bottom: 6px; }
.ps-col { flex: 1 0 186px; min-width: 186px; border: 1px solid var(--ps-line); border-radius: 10px; background: var(--ps-surface-2); padding: 8px; min-height: 120px; }
.ps-col h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 7px; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ps-muted); font-weight: 700; }
.ps-col h3 .n { margin-left: auto; color: var(--ps-muted); font-weight: 500; letter-spacing: 0; font-variant-numeric: tabular-nums; }
.ps-card { display: block; width: 100%; text-align: left; border: 1px solid var(--ps-line); background: var(--ps-surface); border-radius: 8px; padding: 7px 8px; margin: 0 0 6px; font: inherit; color: inherit; cursor: pointer; }
.ps-card:hover { background: var(--ps-surface-3); }
.ps-card:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: 1px; }
.ps-card .t { font-size: 12.4px; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
.ps-card .m { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-top: 5px; }
.ps-card .none { color: var(--ps-muted); font-size: 11px; }
.ps-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.ps-table th { overflow-wrap: anywhere; text-align: left; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ps-muted); font-weight: 700; padding: 6px 8px; border-bottom: 1px solid var(--ps-line); }
.ps-table td { padding: 7px 8px; border-bottom: 1px solid var(--ps-line); vertical-align: top; font-size: 12px; overflow-wrap: anywhere; }
.ps-table tbody tr { cursor: pointer; }
.ps-table tbody tr:hover { background: var(--ps-surface-2); }
.ps-table tbody tr:focus-visible { outline: 2px solid var(--ps-accent); outline-offset: -2px; }
.ps-table .nowrap { white-space: nowrap; }
.ps-table th:nth-child(1), .ps-table td:nth-child(1) { width: 37%; }
.ps-table th:nth-child(2), .ps-table td:nth-child(2) { width: 25%; }
.ps-table th:nth-child(3), .ps-table td:nth-child(3) { width: 16%; }
.ps-table th:nth-child(4), .ps-table td:nth-child(4) { width: 22%; }
.ps-cellchips { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.ps-subbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; }
.ps-group { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--ps-line); border-radius: 8px; padding: 2px; background: var(--ps-surface-2); }
.ps-group button { min-height: 24px; border: 0; border-radius: 6px; background: transparent; color: var(--ps-muted); padding: 3px 8px; font: inherit; font-size: 11.5px; font-weight: 650; cursor: pointer; }
.ps-group button.on { background: var(--ps-surface); color: var(--ps-ink); box-shadow: 0 0 0 1px var(--ps-line); }
.ps-empty { max-width: 64ch; padding: 26px 4px; color: var(--ps-muted); }
.ps-empty h2 { margin: 0 0 5px; font-size: 15px; color: var(--ps-ink); }
.ps-empty p { margin: 0 0 6px; }
.ps-empty code, .ps-code { font: 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--ps-surface-2); border: 1px solid var(--ps-line); border-radius: 5px; padding: 0 4px; overflow-wrap: anywhere; }
.ps-alert { border: 1px solid color-mix(in srgb, var(--ps-bad) 40%, var(--ps-line)); background: color-mix(in srgb, var(--ps-bad) 8%, transparent); color: var(--ps-bad); border-radius: 8px; padding: 7px 9px; margin: 0 0 10px; font-size: 12px; overflow-wrap: anywhere; }
.ps-alert code { font: 11px/1.5 ui-monospace, monospace; }
.ps-warnline { border: 1px solid color-mix(in srgb, var(--ps-warn) 40%, var(--ps-line)); background: color-mix(in srgb, var(--ps-warn) 7%, transparent); color: var(--ps-ink); border-radius: 8px; padding: 6px 9px; margin: 0 0 10px; font-size: 11.5px; }
.ps-mapbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px; font-size: 11.5px; color: var(--ps-muted); }
.ps-mapstage { height: min(64vh, 620px); min-height: 320px; border: 1px solid var(--ps-line); border-radius: 10px; overflow: hidden; background: var(--ps-surface); }
.ps-mapstage > .dmv { height: 100%; }
.ps-maplist { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.ps-maplist li { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.ps-nodebadge { position: absolute; min-width: 18px; height: 16px; padding: 0 4px; border-radius: 999px; border: 1px solid color-mix(in srgb, #FFB020 58%, var(--ps-line)); /* #FFB020 is TYPE_COLOR.req */ background: color-mix(in srgb, #FFB020 22%, var(--ps-surface)); color: var(--ps-ink); font: 9.5px/14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-weight: 700; text-align: center; white-space: nowrap; pointer-events: none; }
.ps-nodefacts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 10px; margin: 0 0 12px; font-size: 12px; }
.ps-nodefacts dt { color: var(--ps-muted); }
.ps-nodefacts dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; }
.ps-drawer .ps-drawerhead { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 8px; }
.ps-drawer .ps-drawerhead .grow { flex: 1; min-width: 0; }
.ps-drawer .ps-drawerhead .ps-btn.close { flex: none; }
.ps-drawer h2 { font-size: 15px; line-height: 1.3; margin: 0 0 5px; overflow-wrap: anywhere; }
.ps-drawer h3 { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--ps-muted); margin: 0 0 4px; }
.ps-sec { margin: 0 0 14px; }
.ps-sec p { margin: 0 0 5px; font-size: 12.5px; overflow-wrap: anywhere; }
.ps-sec .muted { color: var(--ps-muted); font-size: 11.5px; }
.ps-defs { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 10px; margin: 0; font-size: 12px; }
.ps-defs dt { color: var(--ps-muted); }
.ps-defs dd { margin: 0; overflow-wrap: anywhere; }
.ps-pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 11.5px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--ps-surface); border: 1px solid var(--ps-line); border-radius: 8px; padding: 8px; max-height: 340px; overflow: auto; }
.ps-pre .red { color: var(--ps-bad); font-weight: 700; }
.ps-pre .green { color: var(--ps-ok); font-weight: 700; }
.ps-pre .dim { color: var(--ps-muted); }
.ps-chiplist { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.ps-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.ps-loading { display: inline-flex; align-items: center; gap: 7px; color: var(--ps-muted); font-size: 12px; }
.ps-loading:before { content: ""; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--ps-line); border-top-color: var(--ps-accent); animation: ps-spin .8s linear infinite; }
@keyframes ps-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ps-loading:before { animation: none; } }

/* ── Night desk shell: a navigation rail, the mode, and a persistent evidence rail ── */
.ps-top { background: var(--ps-surface); border-bottom-color: var(--ps-line); min-height: 52px; padding: 8px 16px; }
.ps-title { font-size: 18px; letter-spacing: -.015em; }
.ps-back { margin-right: 2px; }
.ps-windowgroup { display: inline-flex; align-items: center; gap: 2px; padding-left: 8px; border-left: 1px solid var(--ps-line); }
.ps-modebar { display: none; }
.ps-shell { flex: 1; min-height: 0; display: grid; grid-template-columns: 212px minmax(0, 1fr) 360px; }
.ps-nav { min-width: 0; min-height: 0; overflow: auto; border-right: 1px solid var(--ps-line); background: var(--ps-paper); padding: 14px 12px 18px; scrollbar-width: thin; }
.ps-nav .ps-kicker { margin: 0 0 7px; }
.ps-modes { display: flex; flex-direction: column; gap: 2px; }
.ps-mode { display: flex; align-items: center; width: 100%; min-height: 36px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ps-muted); padding: 5px 8px; text-align: left; font: inherit; font-size: 12.5px; font-weight: 650; cursor: pointer; }
.ps-mode:hover { background: var(--ps-surface-2); color: var(--ps-ink); }
.ps-mode[aria-selected="true"] { background: var(--ps-surface-2); color: var(--ps-ink); border-color: var(--ps-line-strong); }
.ps-mode[aria-selected="true"]:before { content: ""; width: 2px; height: 16px; margin-right: 7px; background: var(--ps-accent); }
.ps-navsec { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--ps-line); }
.ps-navsec .ps-muted, .ps-navsec p.muted { margin: 0; color: var(--ps-muted); font-size: 12px; line-height: 1.5; }
.ps-navfilter { border: 1px solid var(--ps-line); border-radius: 8px; background: var(--ps-surface); padding: 8px; }
.ps-navfilter .t { font-size: 12.5px; font-weight: 650; line-height: 1.35; margin: 6px 0; overflow-wrap: anywhere; }
.ps-navfilter .ps-meta { white-space: normal; display: block; margin-top: 4px; }
.ps-navfoot { margin-top: 18px; color: var(--ps-muted); font-size: 11px; line-height: 1.5; }
.ps-mail { display: inline-flex; align-items: center; gap: 4px; color: var(--ps-muted); font-size: 11px; }
.ps-rail { min-width: 0; min-height: 0; overflow: auto; border-left: 1px solid var(--ps-line); background: var(--ps-surface); padding: 14px 14px 24px; scrollbar-width: thin; }
.ps-rail > .ps-drawer { border: 0; background: transparent; padding: 0; min-height: 0; overflow: visible; }
.ps-rail .ps-meta, .ps-railreq .ps-meta { white-space: normal; }
.ps-railhead { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; }
.ps-railhead .ps-kicker { margin: 0; }
.ps-railhead .ps-spacer { flex: 1; }
.ps-railreq { border-bottom: 1px solid var(--ps-line); padding-bottom: 10px; margin-bottom: 12px; }
.ps-railreq .t { font-size: 14px; font-weight: 650; line-height: 1.35; margin: 6px 0 0; overflow-wrap: anywhere; }
.ps-railsec { margin: 0 0 14px; }
.ps-railsec h3 { margin: 0 0 5px; font: 700 11px/1.4 var(--ps-sans, system-ui, sans-serif); letter-spacing: .1em; text-transform: uppercase; color: var(--ps-muted); }
.ps-evrow { display: flex; align-items: flex-start; gap: 6px; flex-wrap: wrap; padding: 6px 0; border-bottom: 1px solid var(--ps-line); }
.ps-evrow:last-child { border-bottom: 0; }
.ps-evrow .cmd { flex: 1 1 100%; min-width: 0; color: var(--ps-muted); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-evsum { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 0 0 12px; }
.ps-evsum .cell { border: 1px solid var(--ps-line); border-radius: 6px; background: var(--ps-surface-2); padding: 7px 8px; }
.ps-evsum .n { display: block; color: var(--ps-ink); font: 700 18px/1.1 var(--ps-sans, system-ui, sans-serif); font-variant-numeric: tabular-nums; }
.ps-evsum .l { display: block; color: var(--ps-muted); font-size: 11px; margin-top: 2px; }
.ps-railnote { margin: 12px 0 0; color: var(--ps-muted); font-size: 11.5px; line-height: 1.5; }
.ps-root .dmv {
  --dmv-surface: var(--ps-paper);
  --dmv-surface-2: var(--ps-surface);
  --dmv-surface-3: var(--ps-surface-2);
  --dmv-ink: var(--ps-ink);
  --dmv-muted: var(--ps-muted);
  --dmv-line: var(--ps-line);
  --dmv-line-strong: var(--ps-line-strong);
  --dmv-accent: var(--ps-accent);
  --dmv-accent-ink: var(--ps-paper);
  --dmv-ok: var(--ps-ok);
  --dmv-warn: var(--ps-warn);
  --dmv-danger: var(--ps-bad);
}
.ps-root .ps-status.info { color: var(--ps-info); }
.ps-root .ps-kicker { font-size: 11px; letter-spacing: .1em; }
.ps-root .ps-status { font-size: 11px; }
.ps-root .ps-col h3, .ps-root .ps-table th, .ps-root .ps-drawer h3, .ps-root .ps-sec h3 { font-size: 11px; }
.ps-root .ps-meta { font-size: 11px; }
.ps-root .ps-btn { background: var(--ps-surface-2); border-color: var(--ps-line-strong); }
.ps-root .ps-btn:hover { background: var(--ps-surface-3); }
.ps-root .ps-btn.small { min-height: 24px; }
.ps-root .ps-ro { background: color-mix(in srgb, var(--ps-ok) 10%, transparent); }
.ps-root .ps-chip { background: color-mix(in srgb, var(--ps-type) 18%, var(--ps-surface-2)); }
.ps-root .ps-chip:hover { background: color-mix(in srgb, var(--ps-type) 28%, var(--ps-surface-2)); }
.ps-root .ps-reqrow { background: var(--ps-surface-2); }
.ps-root .ps-reqrow.sel { background: color-mix(in srgb, var(--ps-accent) 8%, var(--ps-surface-2)); }
.ps-root .ps-col, .ps-root .ps-card, .ps-root .ps-table tbody tr:hover { background: var(--ps-surface-2); }
.ps-root .ps-card { background: var(--ps-surface); }
.ps-root .ps-pre { background: var(--ps-paper); }
@container (max-width: 1000px) {
  .ps-shell { grid-template-columns: 196px minmax(0, 1fr); }
  .ps-rail { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--ps-line); max-height: 46vh; }
}
@container (max-width: 760px) {
  .ps-shell { grid-template-columns: minmax(0, 1fr); }
  .ps-nav { border-right: 0; border-bottom: 1px solid var(--ps-line); overflow: visible; }
  .ps-modes { flex-direction: row; overflow-x: auto; padding-bottom: 2px; }
  .ps-mode { flex: 0 0 auto; width: auto; }
  .ps-mode[aria-selected="true"]:before { display: none; }
  .ps-navsec, .ps-navfoot { display: none; }
  .ps-rail { max-height: 55vh; }
}
`

    /* ---------- read + parse helpers (read-only) ---------- */

    function isMissing(error) {
      const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
      return text.includes('not-found') || text.includes('not found') || text.includes('no such file') || text.includes('enoent') || text.includes('no entry at')
    }

    function errorText(error) {
      if (error === null || error === undefined) return 'unknown error'
      return String(error.message ?? error.code ?? error)
    }

    async function readText(remote, sessionId, path, signal) {
      if (remote?.workspaceFiles === undefined || typeof remote.workspaceFiles.read !== 'function') {
        return { ok: false, code: 'workspace_files_unavailable', message: 'This build has no workspaceFiles read API.' }
      }
      let offset = 1
      let text = ''
      let complete = false
      for (let page = 0; page < 60; page += 1) {
        let result
        try {
          result = await remote.workspaceFiles.read(sessionId, path, { offset, limit: 2000 }, signal)
        } catch (error) {
          return { ok: false, code: 'read_failed', message: errorText(error) }
        }
        if (result?.ok !== true) return { ok: false, code: result?.error?.code ?? 'read_failed', message: errorText(result?.error), missing: isMissing(result?.error) }
        const value = result.value
        if (value === null || value === undefined) return { ok: false, code: 'read_failed', message: `${path}: read returned no value` }
        text += value.text
        if (value.eof) {
          complete = true
          break
        }
        if (value.lines === 0) return { ok: false, code: 'read_too_large', message: `${path}: the read did not reach EOF` }
        offset = value.offset + value.lines
        text += '\n'
      }
      if (!complete) return { ok: false, code: 'read_too_large', message: `${path}: more than 60 pages` }
      return { ok: true, text }
    }

    async function readJson(remote, sessionId, path, signal) {
      const read = await readText(remote, sessionId, path, signal)
      if (read.ok !== true) return read
      if (read.text.trim() === '') return { ok: false, code: 'empty_file', message: `${path} is empty` }
      try {
        return { ok: true, value: JSON.parse(read.text), text: read.text }
      } catch (error) {
        return { ok: false, code: 'invalid_json', message: `${path}: ${errorText(error)}` }
      }
    }

    function unquoteScalar(text) {
      const trimmed = String(text ?? '').trim()
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
          return JSON.parse(trimmed)
        } catch {
          return trimmed.slice(1, -1)
        }
      }
      if (trimmed === 'true') return true
      if (trimmed === 'false') return false
      if (trimmed === 'null' || trimmed === '~') return null
      return trimmed
    }

    function splitInlineList(value) {
      const out = []
      let current = ''
      let quote = null
      for (const character of String(value)) {
        if (quote !== null) {
          current += character
          if (character === quote) quote = null
        } else if (character === '"' || character === "'") {
          quote = character
          current += character
        } else if (character === ',') {
          out.push(current)
          current = ''
        } else {
          current += character
        }
      }
      if (current.trim() !== '') out.push(current)
      return out.map(unquoteScalar)
    }

    /** The state entity format is line-based (lib/format.mjs); this reads only its subset. */
    function parseEntityText(text) {
      const normalized = String(text ?? '').replace(/\r\n/g, '\n')
      const lines = normalized.split('\n')
      if (lines[0] !== '---') return { frontmatter: {}, body: normalized }
      const close = lines.indexOf('---', 1)
      if (close < 0) return { frontmatter: {}, body: normalized }
      const frontmatter = {}
      let currentList = null
      let currentMap = null
      for (let index = 1; index < close; index += 1) {
        const line = lines[index]
        if (line.trim() === '' || line.trim().startsWith('#')) continue
        const top = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
        if (top !== null) {
          const key = top[1]
          const value = top[2]
          currentList = null
          currentMap = null
          if (value.trim() === '') {
            let next = ''
            for (let probe = index + 1; probe < close; probe += 1) {
              if (lines[probe].trim() === '') continue
              next = lines[probe]
              break
            }
            if (/^\s{2}[A-Za-z][\w-]*:\s/.test(next)) {
              frontmatter[key] = {}
              currentMap = frontmatter[key]
            } else {
              frontmatter[key] = []
              currentList = frontmatter[key]
            }
            continue
          }
          if (value.trim().startsWith('[') && value.trim().endsWith(']')) {
            frontmatter[key] = splitInlineList(value.trim().slice(1, -1).trim())
            continue
          }
          frontmatter[key] = unquoteScalar(value)
          continue
        }
        const item = /^\s{2}-\s*(.*)$/.exec(line)
        if (item !== null && currentList !== null) {
          const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(item[1])
          if (pair !== null) currentList.push({ [pair[1]]: unquoteScalar(pair[2]) })
          else currentList.push(unquoteScalar(item[1]))
          continue
        }
        const nested = /^\s{2,4}([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
        if (nested !== null && currentMap !== null) currentMap[nested[1]] = unquoteScalar(nested[2])
      }
      const body = lines.slice(close + 1).join('\n').replace(/^\n+/, '').replace(/\n+$/, '')
      return { frontmatter, body }
    }

    /* ---------- data loading ---------- */

    function validateIndex(index) {
      if (index === null || typeof index !== 'object' || Array.isArray(index)) return 'index.json is not an object'
      if (index.schemaVersion !== 1) return `unsupported index schemaVersion ${String(index.schemaVersion)}; this panel reads version 1`
      for (const key of ['reqs', 'tasks', 'tests', 'decisions']) {
        if (!Array.isArray(index[key])) return `index.json has no ${key} array`
      }
      if (index.reqs.some((row) => typeof row?.id !== 'string')) return 'index.json has a REQ row without an id'
      return null
    }

    async function loadAnalysis(remote, sessionId, signal) {
      if (remote?.workspaceFiles === undefined || typeof remote.workspaceFiles.list !== 'function') {
        return { records: [], error: 'The workspaceFiles listing API is unavailable.' }
      }
      let listing
      try {
        listing = await remote.workspaceFiles.list(sessionId, ANALYSIS_DIR, signal)
      } catch (error) {
        return { records: [], error: errorText(error) }
      }
      if (listing?.ok !== true) {
        if (isMissing(listing?.error)) return { records: [], error: null, note: 'no docs/analysis directory' }
        return { records: [], error: errorText(listing?.error) }
      }
      const entries = Array.isArray(listing.value?.entries) ? listing.value.entries : []
      const files = entries.filter((entry) => entry.type === 'file' && String(entry.name).endsWith('.json')).slice(0, 40)
      const records = []
      for (const file of files) {
        const read = await readJson(remote, sessionId, `${ANALYSIS_DIR}/${file.name}`, signal)
        if (read.ok === true && read.value !== null && typeof read.value === 'object' && !Array.isArray(read.value)) records.push(read.value)
      }
      return { records, error: null, truncated: listing.value?.truncated === true, count: files.length }
    }

    async function loadWorkspace(remote, sessionId, signal) {
      const indexRead = await readJson(remote, sessionId, INDEX_PATH, signal)
      if (indexRead.ok !== true) {
        if (indexRead.missing === true) return { phase: 'empty', reason: 'missing-index' }
        return { phase: 'error', code: indexRead.code ?? 'index_unreadable', message: indexRead.message ?? 'index.json could not be read' }
      }
      const invalid = validateIndex(indexRead.value)
      if (invalid !== null) return { phase: 'error', code: 'projections_invalid', message: invalid }
      const index = indexRead.value
      const entities = new Map()
      const issues = []
      const rows = [
        ...index.reqs.map((row) => ({ kind: 'req', id: row.id })),
        ...index.tasks.map((row) => ({ kind: 'task', id: row.id })),
        ...index.tests.map((row) => ({ kind: 'test', id: row.id })),
        ...index.decisions.map((row) => ({ kind: 'decision', id: row.id })),
      ]
      await Promise.all(
        rows.map(async ({ kind, id }) => {
          const path = `state/${KIND_DIR[kind]}/${id}.md`
          const read = await readText(remote, sessionId, path, signal)
          if (read.ok === true) {
            const parsed = parseEntityText(read.text)
            entities.set(id, { kind, id, path, frontmatter: parsed.frontmatter, body: parsed.body })
            return
          }
          entities.set(id, { kind, id, path, frontmatter: { id, kind, title: id }, body: '', error: read.message ?? read.code })
          issues.push(`${id}: ${read.message ?? read.code ?? 'unreadable'}`)
        }),
      )
      const analysis = await loadAnalysis(remote, sessionId, signal)
      return { phase: 'ready', index, entities, analysis, issues }
    }

    async function loadMapViews(remote, sessionId) {
      if (remote?.commands === undefined || typeof remote.commands.execute !== 'function') {
        return { ok: false, code: 'command_unavailable', message: 'This build has no command transport, so the designmap scene cannot be requested.' }
      }
      let result
      try {
        result = await remote.commands.execute(sessionId, `/designmap ${JSON.stringify({ op: 'views' })}`, [])
      } catch (error) {
        return { ok: false, code: 'command_failed', message: errorText(error) }
      }
      if (result?.ok !== true) return { ok: false, code: result?.error?.code ?? 'command_failed', message: errorText(result?.error) }
      const outcome = result.value?.result
      if (outcome?.kind === 'error') {
        const text = String(outcome.text ?? '')
        const match = /^designmap:\s*([A-Za-z0-9_]+):\s*([\s\S]*)$/.exec(text)
        return { ok: false, code: match === null ? 'command_failed' : match[1], message: match === null ? text : match[2] }
      }
      if (outcome?.kind !== 'success') return { ok: false, code: 'command_failed', message: 'The designmap command returned an unexpected result.' }
      let payload
      try {
        payload = JSON.parse(outcome.text)
      } catch (error) {
        return { ok: false, code: 'command_result_invalid', message: errorText(error) }
      }
      if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.views)) {
        return { ok: false, code: 'command_result_invalid', message: 'The designmap command returned no views.' }
      }
      return { ok: true, payload }
    }

    /* ---------- cross-links ---------- */

    function kindOfId(id) {
      const text = String(id ?? '')
      if (text.startsWith('REQ-')) return 'req'
      if (text.startsWith('TASK-')) return 'task'
      if (text.startsWith('TEST-')) return 'test'
      if (text.startsWith('DEC-')) return 'decision'
      return 'evidence'
    }

    function buildAnalysisLinks(analysis, entities) {
      const reqByAnalysisKey = new Map()
      for (const entity of entities.values()) {
        if (entity.kind !== 'req') continue
        const ref = entity.frontmatter?.analysisRef
        if (ref === null || typeof ref !== 'object') continue
        reqByAnalysisKey.set(`${String(ref.initiative ?? '')}#${String(ref.requirementId ?? '')}`, entity.id)
      }
      const componentReqs = new Map()
      for (const record of analysis?.records ?? []) {
        const recordId = String(record?.id ?? '')
        const trace = Array.isArray(record?.trace) ? record.trace : []
        for (const row of trace) {
          if (row === null || typeof row !== 'object') continue
          const componentId = String(row.componentId ?? '')
          if (componentId === '') continue
          const reqId = reqByAnalysisKey.get(`${recordId}#${String(row.requirementId ?? '')}`)
          if (reqId === undefined) continue
          if (!componentReqs.has(componentId)) componentReqs.set(componentId, new Set())
          componentReqs.get(componentId).add(reqId)
        }
      }
      return { componentReqs, reqByAnalysisKey }
    }

    function requirementsForNode(node, links) {
      if (node === null || node === undefined || links === null || links === undefined) return []
      const ids = new Set()
      const nodeId = String(node.id ?? '')
      const suffix = nodeId.includes('.') ? nodeId.slice(nodeId.lastIndexOf('.') + 1) : nodeId
      for (const componentId of [nodeId, suffix]) {
        const set = links.componentReqs.get(componentId)
        if (set !== undefined) for (const id of set) ids.add(id)
      }
      for (const [componentId, set] of links.componentReqs) {
        if (nodeId.endsWith(`.${componentId}`)) for (const id of set) ids.add(id)
      }
      return [...ids].sort()
    }

    function nodesForRequirement(scene, reqId, links) {
      const ids = new Set()
      if (scene === null || scene === undefined) return ids
      for (const node of scene.nodes ?? []) {
        if (requirementsForNode(node, links).includes(reqId)) ids.add(node.id)
      }
      return ids
    }

    function statusTone(status) {
      if (status === 'done' || status === 'verified' || status === 'accepted') return 'ok'
      if (status === 'blocked' || status === 'failing' || status === 'rejected') return 'bad'
      if (status === 'stale' || status === 'superseded') return 'warn'
      if (status === 'review' || status === 'active') return 'info'
      return ''
    }

    function titleOf(entity, fallback) {
      const title = entity?.frontmatter?.title
      return typeof title === 'string' && title.trim() !== '' ? title : fallback ?? String(entity?.id ?? '')
    }

    function shortHash(value) {
      if (typeof value !== 'string' || value === '') return 'no hash recorded'
      const bare = value.startsWith('sha256:') ? value.slice(7) : value
      return `${value.startsWith('sha256:') ? 'sha256:' : ''}${bare.slice(0, 12)}…`
    }

    /* ---------- small shared components ---------- */

    function TypeChip({ kind, id, title, onClick, static: isStatic }) {
      const label = KIND_LABEL[kind] ?? KIND_LABEL.evidence
      const style = { '--ps-type': TYPE_COLOR[kind] ?? TYPE_COLOR.evidence }
      const className = `ps-chip ${isStatic === true || typeof onClick !== 'function' ? 'static' : ''} ${kind === 'evidence' ? 'evidence' : ''}`
      const content = [
        h('span', { className: 'mark', key: 'mark', 'aria-hidden': 'true' }),
        h('code', { key: 'id' }, String(id ?? '')),
      ]
      if (isStatic === true || typeof onClick !== 'function') {
        return h('span', { className, style, title: title ?? `${label} ${id}` }, ...content)
      }
      return h('button', { type: 'button', className, style, onClick, title: title ?? `${label} ${id}`, 'aria-label': title ?? `Open ${label} ${id}` }, ...content)
    }

    function Status({ status }) {
      return h('span', { className: `ps-status ${statusTone(status)}` }, String(status ?? 'unknown'))
    }

    function Gap({ children, onClick, title, static: isStatic }) {
      if (isStatic === true || typeof onClick !== 'function') return h('span', { className: 'ps-gap static' }, children)
      return h('button', { type: 'button', className: 'ps-gap', onClick, title: title ?? children }, children)
    }

    function Alert({ code, children }) {
      return h('div', { className: 'ps-alert', role: 'alert' }, code === undefined ? null : h('code', null, `${code}: `), children)
    }

    function Empty({ title, children, onReload }) {
      return h('div', { className: 'ps-empty' },
        h('h2', null, title),
        children,
        typeof onReload === 'function' ? h('button', { type: 'button', className: 'ps-btn small', onClick: onReload, style: { marginTop: 8 } }, 'Reload') : null,
      )
    }

    /* ---------- requirements mode ---------- */

    function RequirementRow({ req, data, selected, onSelect, onOpen, onOpenEntityDrawer }) {
      const entity = data.entities.get(req.id)
      const fm = entity?.frontmatter ?? {}
      const criteria = Array.isArray(fm.criteria) ? fm.criteria : []
      const taskCount = req.tasks.length
      const testCount = req.tests.length
      const decisionCount = req.decisions.length
      return h('li', { className: `ps-reqrow${selected ? ' sel' : ''}` },
        h('div', { className: 'body' },
          h('button', {
            type: 'button',
            className: 'ps-rowbtn',
            'aria-pressed': selected,
            onClick: () => onSelect(req.id),
            title: selected ? `Clear the ${req.id} filter` : `Filter the other modes by ${req.id}`,
          },
          h('div', { className: 'ps-rowmeta' },
            h(TypeChip, { kind: 'req', id: req.id, static: true }),
            h(Status, { status: req.status }),
            selected ? h('span', { className: 'ps-status info' }, 'filter') : null,
          ),
          h('div', { className: 'ps-rowtitle' }, titleOf(entity, req.id)),
          ),
          criteria.length > 0
            ? h('ol', { className: 'ps-criteria' }, criteria.slice(0, 4).map((criterion, index) => h('li', { key: index }, String(criterion))))
            : h('p', { className: 'ps-criteria' }, 'No criteria recorded — the state core reports `req_criteria_missing`.'),
          h('div', { className: 'ps-rowmeta' },
            taskCount > 0
              ? h('span', { className: 'ps-count' }, h('b', null, String(taskCount)), taskCount === 1 ? ' task' : ' tasks')
              : h(Gap, { onClick: () => { onSelect(req.id); onOpen('board', req.id) }, title: `No task is linked to ${req.id}; open the board filtered by it` }, 'no task'),
            testCount > 0
              ? h('span', { className: 'ps-count' }, h('b', null, String(testCount)), testCount === 1 ? ' test' : ' tests')
              : h(Gap, { onClick: () => { onSelect(req.id); onOpen('trace', req.id) }, title: `No test is linked to ${req.id}; open tests and trace filtered by it` }, 'no test'),
            decisionCount > 0
              ? h('span', { className: 'ps-count' }, h('b', null, String(decisionCount)), decisionCount === 1 ? ' decision' : ' decisions')
              : h(Gap, { static: true, title: 'No decision is linked to this requirement' }, 'no decision'),
            h('span', { className: 'ps-spacer' }),
            h('button', { type: 'button', className: 'ps-btn small', onClick: () => onOpenEntityDrawer(req.id) }, 'Details'),
          ),
        ),
      )
    }

    function RequirementsMode({ data, filter, onSelect, onOpenMode, onOpenEntityDrawer }) {
      const reqs = data.index.reqs
      if (reqs.length === 0) return h(Empty, { title: 'No requirement in the registry' }, h('p', null, 'The state core wrote projections, but the REQ registry is empty. Requirements are created through the state core; this panel does not create them.'))
      return h('div', null,
        h('p', { className: 'ps-kicker' }, 'Business requirements'),
        h('ul', { className: 'ps-reqlist' }, reqs.map((req) => h(RequirementRow, {
          key: req.id,
          req,
          data,
          selected: filter === req.id,
          onSelect: (id) => onSelect(filter === id ? null : id),
          onOpen: onOpenMode,
          onOpenEntityDrawer,
        }))),
      )
    }

    /* ---------- board mode ---------- */

    function TaskCard({ task, data, onOpen }) {
      const entity = data.entities.get(task.id)
      const fm = entity?.frontmatter ?? {}
      const tests = data.index.tests.filter((test) => Array.isArray(test.evidenceRefs) && test.evidenceRefs.some((ref) => ref.kind === 'task' && ref.id === task.id))
      return h('button', {
        type: 'button',
        className: 'ps-card',
        onClick: () => onOpen(task.id),
        'aria-label': `${task.id}: ${titleOf(entity, task.id)}, ${task.status}${task.reqId ? `, requirement ${task.reqId}` : ', chore'}`,
      },
        h('div', { className: 't' }, titleOf(entity, task.id)),
        h('div', { className: 'm' },
          h(TypeChip, { kind: 'task', id: task.id, static: true }),
          h(Status, { status: task.status }),
        ),
        h('div', { className: 'm' },
          task.reqId ? h(TypeChip, { kind: 'req', id: task.reqId, static: true }) : (task.chore === true ? h('span', { className: 'ps-chip static', style: { '--ps-type': TYPE_COLOR.evidence } }, h('span', { className: 'mark' }), h('code', null, 'chore')) : h('span', { className: 'none' }, 'no requirement')),
          tests.length > 0 ? h('span', { className: 'ps-count' }, h('b', null, String(tests.length)), tests.length === 1 ? ' test' : ' tests') : h('span', { className: 'none' }, fm.status === 'done' ? 'no test' : ''),
        ),
      )
    }

    function BoardMode({ data, filter, onOpenTask, onClearFilter }) {
      const tasks = data.index.tasks.filter((task) => filter === null || task.reqId === filter)
      if (data.index.tasks.length === 0) return h(Empty, { title: 'No task on the board' }, h('p', null, 'The task board is a projection of state/task/. Tasks are created in the Tasks panel or by the orchestrator.'))
      if (filter !== null && tasks.length === 0) return h('div', null,
        h('p', { className: 'ps-kicker' }, 'Task board'),
        h('p', { className: 'ps-empty' }, `No task is linked to ${filter}. This is a traceability gap, not an empty board: `, h('button', { type: 'button', className: 'ps-gap', onClick: onClearFilter }, 'clear the filter'), ' to see every task.'),
      )
      return h('div', null,
        h('p', { className: 'ps-kicker' }, filter === null ? 'Task board' : `Task board · filtered by ${filter}`),
        h('div', { className: 'ps-board', role: 'list' }, TASK_COLUMNS.map((column) => {
          const items = tasks.filter((task) => column.statuses.includes(task.status))
          return h('div', { className: 'ps-col', key: column.id, role: 'group', 'aria-label': `${column.label} tasks` },
            h('h3', null, column.label, h('span', { className: 'n' }, String(items.length))),
            items.length === 0
              ? h('div', { className: 'ps-empty', style: { padding: '6px 2px', fontSize: 11 } }, '—')
              : items.map((task) => h('div', { key: task.id, role: 'listitem' }, h(TaskCard, { task, data, onOpen: onOpenTask }))),
          )
        })),
      )
    }

    /* ---------- tests + trace mode ---------- */

    function TestsTable({ data, filter, onOpenTest, onSelectReq }) {
      const tests = data.index.tests.filter((test) => filter === null || test.reqId === filter)
      if (data.index.tests.length === 0) return h(Empty, { title: 'No test recorded' }, h('p', null, 'The TEST registry is empty. Tests are recorded by the test-case runner and the state core; this panel does not create them.'))
      if (tests.length === 0) return h('p', { className: 'ps-empty' }, `No test is linked to ${filter}. That is a traceability gap; clear the filter to see every test.`)
      return h('table', { className: 'ps-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Test'),
          h('th', { scope: 'col' }, 'Requirement'),
          h('th', { scope: 'col' }, 'Status'),
          h('th', { scope: 'col' }, 'Evidence'),
        )),
        h('tbody', null, tests.map((test) => {
          const entity = data.entities.get(test.id)
          const fm = entity?.frontmatter ?? {}
          const refs = [...(Array.isArray(test.evidenceRefs) ? test.evidenceRefs : []), ...(Array.isArray(fm.evidenceRefs) ? fm.evidenceRefs.map((id) => ({ kind: kindOfId(id), id })) : [])]
          return h('tr', {
            key: test.id,
            tabIndex: 0,
            onClick: () => onOpenTest(test.id),
            onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenTest(test.id) } },
            'aria-label': `${test.id}: ${titleOf(entity, test.id)}`,
          },
            h('td', null,
              h('div', { className: 'ps-cellchips' }, h(TypeChip, { kind: 'test', id: test.id, static: true })),
              h('div', { style: { marginTop: 3, fontWeight: 600 } }, titleOf(entity, test.id)),
              typeof fm.command === 'string' && fm.command !== '' ? h('div', { className: 'ps-meta', style: { marginTop: 2 } }, h('code', null, fm.command)) : null,
            ),
            h('td', null, test.reqId ? h(TypeChip, { kind: 'req', id: test.reqId, onClick: (event) => { event.stopPropagation(); onSelectReq(test.reqId) } }) : h(Gap, { static: true }, 'no requirement')),
            h('td', null, h(Status, { status: test.status })),
            h('td', null, refs.length > 0
              ? h('div', { className: 'ps-cellchips' }, refs.map((ref, index) => h(TypeChip, { key: `${ref.id}-${index}`, kind: kindOfId(ref.id), id: ref.id, title: ref.hash ? `${ref.kind ?? kindOfId(ref.id)} ${ref.id}, ${shortHash(ref.hash)}` : undefined, static: true })))
              : h(Gap, { static: true, title: 'No evidence reference is recorded on this test' }, 'no evidence')),
          )
        })),
      )
    }

    function TraceMatrix({ data, filter, onSelectReq, onOpenMode }) {
      const reqs = data.index.reqs.filter((req) => filter === null || req.id === filter)
      if (reqs.length === 0) return h('p', { className: 'ps-empty' }, 'No requirement matches the filter.')
      const chips = (ids, kind, emptyLabel, emptyMode) => ids.length > 0
        ? h('div', { className: 'ps-cellchips' }, ids.map((id) => h(TypeChip, { key: id, kind, id })))
        : h(Gap, { onClick: () => onOpenMode(emptyMode, filter) }, emptyLabel)
      return h('table', { className: 'ps-table' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Requirement'),
          h('th', { scope: 'col' }, 'Tasks'),
          h('th', { scope: 'col' }, 'Tests'),
          h('th', { scope: 'col' }, 'Decisions'),
        )),
        h('tbody', null, reqs.map((req) => {
          const entity = data.entities.get(req.id)
          return h('tr', { key: req.id },
            h('td', null,
              h('div', { className: 'ps-cellchips' },
                h(TypeChip, { kind: 'req', id: req.id, onClick: () => onSelectReq(filter === req.id ? null : req.id) }),
                h(Status, { status: req.status }),
              ),
              h('div', { style: { marginTop: 3, fontWeight: 600 } }, titleOf(entity, req.id)),
            ),
            h('td', null, chips(req.tasks, 'task', 'no task', 'board')),
            h('td', null, chips(req.tests, 'test', 'no test', 'trace')),
            h('td', null, chips(req.decisions, 'decision', 'no decision', 'req')),
          )
        })),
      )
    }

    function TestsMode({ data, filter, subview, setSubview, onOpenTest, onSelectReq, onOpenMode }) {
      if (data.index.tests.length === 0 && data.index.reqs.length === 0) return h(Empty, { title: 'No test and no trace' }, h('p', null, 'The projections carry no TEST and no REQ row.'))
      return h('div', null,
        h('div', { className: 'ps-subbar' },
          h('p', { className: 'ps-kicker', style: { margin: 0 } }, 'Tests and traceability'),
          h('span', { className: 'ps-spacer' }),
          h('div', { className: 'ps-group', role: 'group', 'aria-label': 'Tests or trace matrix' },
            h('button', { type: 'button', className: subview === 'tests' ? 'on' : '', 'aria-pressed': subview === 'tests', onClick: () => setSubview('tests') }, 'Tests'),
            h('button', { type: 'button', className: subview === 'trace' ? 'on' : '', 'aria-pressed': subview === 'trace', onClick: () => setSubview('trace') }, 'Trace matrix'),
          ),
        ),
        subview === 'trace'
          ? h(TraceMatrix, { data, filter, onSelectReq, onOpenMode })
          : h(TestsTable, { data, filter, onOpenTest, onSelectReq }),
      )
    }

    /* ---------- map mode ---------- */

    function MapMode({ data, analysisLinks, map, viewId, onView, filter, onOpenNode, onReload, onSelectReq }) {
      if (map.phase === 'loading' || map.phase === 'idle') return h('div', null, h('p', { className: 'ps-kicker' }, 'Design map'), h('p', { className: 'ps-loading' }, 'Requesting the designmap scene…'))
      if (map.phase === 'error') {
        return h('div', null,
          h('p', { className: 'ps-kicker' }, 'Design map'),
          h(Alert, { code: map.code }, map.message),
          h('p', { className: 'ps-muted', style: { color: 'var(--ps-muted)', fontSize: 12 } }, 'The map is drawn by designmap; this panel only asks for the rendered scene. A missing designmap row or an unrendered model is shown here, not worked around.'),
          h('button', { type: 'button', className: 'ps-btn small', onClick: onReload }, 'Retry'),
        )
      }
      const views = map.payload.views
      if (views.length === 0) {
        return h('div', null,
          h('p', { className: 'ps-kicker' }, 'Design map'),
          h(Empty, { title: 'No design map in this workspace' }, h('p', null, 'designmap has no rendered view here. The agent creates the model and renders it with designmap; this panel does not draw a map of its own.')),
        )
      }
      const active = views.find((entry) => entry?.view?.viewId === viewId) ?? views[0]
      const scene = active.scene
      const highlight = filter === null ? null : nodesForRequirement(scene, filter, analysisLinks)
      const badges = {}
      let linkedNodes = 0
      for (const node of scene.nodes ?? []) {
        const reqs = requirementsForNode(node, analysisLinks)
        if (reqs.length > 0) {
          linkedNodes += 1
          badges[node.id] = `REQ ${reqs.length}`
        }
      }
      return h('div', null,
        h('div', { className: 'ps-mapbar' },
          h('span', { className: 'ps-kicker', style: { margin: 0 } }, 'Design map'),
          views.length > 1
            ? h('label', { className: 'ps-count' }, h('span', { className: 'ps-visually-hidden' }, 'Design map view'),
                h('select', {
                  className: 'ps-btn small',
                  value: active.view.viewId,
                  onChange: (event) => onView(event.target.value),
                  'aria-label': 'Design map view',
                }, views.map((entry) => h('option', { key: entry.view.viewId, value: entry.view.viewId }, entry.view.title || entry.view.viewId))),
              )
            : null,
          h('span', { className: 'ps-meta' }, `${scene.nodes.length} nodes · ${scene.edges.length} edges · ${linkedNodes} traced to a requirement`),
          h('span', { className: 'ps-spacer' }),
          h('button', { type: 'button', className: 'ps-btn small', onClick: onReload }, 'Reload scene'),
        ),
        filter !== null
          ? h('p', { className: 'ps-warnline' },
              highlight.size > 0
                ? `Highlighting ${highlight.size} node${highlight.size === 1 ? '' : 's'} traced to ${filter}. Other nodes are dimmed; the scene geometry is unchanged.`
                : `No node on this view is traced to ${filter}. The map link comes from the analysis record trace[].componentId; a missing row is a gap in the projection, not a missing scene.`)
          : null,
        h('div', { className: 'ps-mapstage' },
          SceneCanvas === undefined
            ? h('div', { className: 'ps-empty' }, h('h2', null, 'The designmap renderer is not available'), h('p', null, 'The installed @cc/dsh-designmap client does not export SceneCanvas. This panel will not draw a second map.'))
            : h(SceneCanvas, {
                scene,
                overlays: map.payload.overlays?.rows ?? {},
                highlight,
                dim: filter !== null,
                overlay: h(React.Fragment, null, (scene.nodes ?? []).filter((node) => badges[node.id] !== undefined).map((node) => h('div', {
                  key: `badge-${node.id}`,
                  className: 'ps-nodebadge',
                  style: { left: node.x + node.w - 9, top: node.y - 9 },
                  title: `${badges[node.id]} traced to ${requirementsForNode(node, analysisLinks).join(', ')}`,
                }, badges[node.id]))),
                label: `${active.view.title || active.view.viewId}: design map, read-only`,
                onNodeClick: (node) => onOpenNode(node, active),
              }),
        ),
        h('p', { className: 'ps-meta', style: { marginTop: 6 } }, 'Click a node to see the requirements traced to it. Geometry: designmap (React Flow); this panel computes none.'),
        linkedNodes > 0
          ? h('div', null,
              h('p', { className: 'ps-kicker', style: { marginTop: 12 } }, 'Requirements traced to this map'),
              h('ul', { className: 'ps-maplist' }, (scene.nodes ?? []).filter((node) => requirementsForNode(node, analysisLinks).length > 0).map((node) => h('li', { key: node.id },
                h('span', { className: 'ps-meta' }, node.label || node.id),
                requirementsForNode(node, analysisLinks).map((reqId) => h(TypeChip, { key: reqId, kind: 'req', id: reqId, onClick: () => onSelectReq(reqId) })),
              ))),
            )
          : null,
      )
    }

    /* ---------- evidence block + drawer ---------- */

    function EvidenceBlock({ text }) {
      if (typeof text !== 'string' || text.trim() === '') return null
      const lines = text.split('\n')
      return h('pre', { className: 'ps-pre' }, lines.map((line, index) => {
        const trimmed = line.trimStart()
        const tone = /^RED\b/i.test(trimmed) ? 'red' : /^GREEN\b/i.test(trimmed) ? 'green' : /^(exit|evidence|run)\b/i.test(trimmed) ? 'dim' : null
        return h('span', { key: index, className: tone ?? undefined }, `${line}${index < lines.length - 1 ? '\n' : ''}`)
      }))
    }

    function EntityLinks({ kind, id, filter, data, analysisLinks, node, onOpenEntity, onOpenRequirement, onOpenMode, onCloseFilter }) {
      const index = data.index
      const req = kind === 'req' ? index.reqs.find((row) => row.id === id) : null
      const test = kind === 'test' ? index.tests.find((row) => row.id === id) : null
      const task = kind === 'task' ? index.tasks.find((row) => row.id === id) : null
      const decision = kind === 'decision' ? index.decisions.find((row) => row.id === id) : null
      const entity = data.entities.get(id)
      const fm = entity?.frontmatter ?? {}
      const sections = []

      if (req !== null) {
        sections.push(h('div', { className: 'ps-sec', key: 'tasks' },
          h('h3', null, `Tasks (${req.tasks.length})`),
          req.tasks.length > 0
            ? h('div', { className: 'ps-chiplist' }, req.tasks.map((taskId) => h(TypeChip, { key: taskId, kind: 'task', id: taskId, onClick: () => onOpenEntity(taskId) })))
            : h('p', { className: 'muted' }, h(Gap, { onClick: () => onOpenMode('board', req.id) }, 'no task'), ' This requirement has no task in the projections.'),
        ))
        sections.push(h('div', { className: 'ps-sec', key: 'tests' },
          h('h3', null, `Tests (${req.tests.length})`),
          req.tests.length > 0
            ? h('div', { className: 'ps-chiplist' }, req.tests.map((testId) => h(TypeChip, { key: testId, kind: 'test', id: testId, onClick: () => onOpenEntity(testId) })))
            : h('p', { className: 'muted' }, h(Gap, { onClick: () => onOpenMode('trace', req.id) }, 'no test'), ' No test proves this requirement yet.'),
        ))
        sections.push(h('div', { className: 'ps-sec', key: 'decisions' },
          h('h3', null, `Decisions (${req.decisions.length})`),
          req.decisions.length > 0
            ? h('div', { className: 'ps-chiplist' }, req.decisions.map((decisionId) => h(TypeChip, { key: decisionId, kind: 'decision', id: decisionId, onClick: () => onOpenEntity(decisionId) })))
            : h('p', { className: 'muted' }, h(Gap, { static: true }, 'no decision'), ' The requirement has no linked decision.'),
        ))
      }

      if (task !== null) {
        sections.push(h('div', { className: 'ps-sec', key: 'req' },
          h('h3', null, 'Requirement'),
          task.reqId
            ? h('div', { className: 'ps-chiplist' }, h(TypeChip, { kind: 'req', id: task.reqId, onClick: () => onOpenEntity(task.reqId) }))
            : h('p', { className: 'muted' }, task.chore === true ? `Chore: ${String(fm.choreReason ?? 'reason not recorded')}.` : 'This task has no requirement.', ' The state core reports `task_req_missing` for a non-chore task.'),
        ))
        const tests = index.tests.filter((row) => Array.isArray(row.evidenceRefs) && row.evidenceRefs.some((ref) => ref.kind === 'task' && ref.id === task.id))
        sections.push(h('div', { className: 'ps-sec', key: 'tests' },
          h('h3', null, `Tests (${tests.length})`),
          tests.length > 0
            ? h('div', { className: 'ps-chiplist' }, tests.map((row) => h(TypeChip, { key: row.id, kind: 'test', id: row.id, onClick: () => onOpenEntity(row.id) })))
            : h('p', { className: 'muted' }, 'No test links this task as evidence.'),
        ))
      }

      if (test !== null) {
        const reqId = test.reqId
        sections.push(h('div', { className: 'ps-sec', key: 'req' },
          h('h3', null, 'Requirement'),
          reqId
            ? h('div', { className: 'ps-chiplist' }, h(TypeChip, { kind: 'req', id: reqId, onClick: () => onOpenEntity(reqId) }))
            : h('p', { className: 'muted' }, 'This test has no requirement. The state core reports `test_req_required` for a test without one.'),
        ))
        const refs = Array.isArray(test.evidenceRefs) ? test.evidenceRefs : []
        const extra = Array.isArray(fm.evidenceRefs) ? fm.evidenceRefs : []
        sections.push(h('div', { className: 'ps-sec', key: 'evidence' },
          h('h3', null, `Evidence references (${refs.length + extra.length})`),
          refs.length + extra.length > 0
            ? h('div', { className: 'ps-chiplist' },
                refs.map((ref, position) => h(TypeChip, {
                  key: `${ref.id}-${position}`,
                  kind: kindOfId(ref.id),
                  id: ref.id,
                  title: `${ref.kind ?? kindOfId(ref.id)} ${ref.id}; ${shortHash(ref.hash)}`,
                  onClick: data.entities.has(ref.id) ? () => onOpenEntity(ref.id) : undefined,
                  static: !data.entities.has(ref.id),
                })),
                extra.map((refId, position) => h(TypeChip, {
                  key: `${refId}-extra-${position}`,
                  kind: kindOfId(refId),
                  id: refId,
                  static: !data.entities.has(refId),
                  onClick: data.entities.has(refId) ? () => onOpenEntity(refId) : undefined,
                })),
              )
            : h('p', { className: 'muted' }, h(Gap, { static: true }, 'no evidence'), ' A test without a recorded reference cannot carry a red→green pair.'),
        ))
      }

      if (decision !== null) {
        const reqIds = index.reqs.filter((row) => row.decisions.includes(decision.id)).map((row) => row.id)
        sections.push(h('div', { className: 'ps-sec', key: 'req' },
          h('h3', null, 'Requirements'),
          reqIds.length > 0
            ? h('div', { className: 'ps-chiplist' }, reqIds.map((reqId) => h(TypeChip, { key: reqId, kind: 'req', id: reqId, onClick: () => onOpenEntity(reqId) })))
            : h('p', { className: 'muted' }, 'No requirement links this decision.'),
        ))
      }

      if (kind === 'node') {
        const reqIds = requirementsForNode(node, analysisLinks)
        sections.push(h('div', { className: 'ps-sec', key: 'reqs' },
          h('h3', null, `Requirements traced to ${node.label || node.id} (${reqIds.length})`),
          reqIds.length > 0
            ? h('div', { className: 'ps-chiplist' }, reqIds.map((reqId) => h(TypeChip, { key: reqId, kind: 'req', id: reqId, title: `Go to requirement ${reqId} in Requirements mode`, onClick: () => onOpenRequirement(reqId) })))
            : h('p', { className: 'muted' }, 'No requirement is traced to this node. The link comes from the analysis record trace[].componentId; an unmatched node is a gap in the analysis, not a missing requirement.'),
        ))
      }

      return h('div', null,
        sections,
        filter !== null && req === null
          ? h('div', { className: 'ps-sec' }, h('h3', null, 'Current filter'), h('p', { className: 'muted' }, `The panel is filtered by ${filter}. `, h('button', { type: 'button', className: 'ps-gap', onClick: onCloseFilter }, 'clear filter'), ' to see every row.'))
          : null,
      )
    }

    /** How many evidence references a TEST carries, from the index and the entity metadata. */
    function evidenceCountOf(data, test) {
      const entity = data.entities.get(test.id)
      const fm = entity?.frontmatter ?? {}
      return (Array.isArray(test.evidenceRefs) ? test.evidenceRefs.length : 0) + (Array.isArray(fm.evidenceRefs) ? fm.evidenceRefs.length : 0)
    }

    /**
     * The persistent evidence rail. It is not a second drawer: it always shows the evidence
     * the projections carry for the current requirement filter (or, with no filter, the
     * evidence summary of the whole view). Opening an entity replaces this rail with the one
     * drawer; closing the drawer returns to this summary, so the column is never empty and
     * the evidence never sits on a separate screen.
     */
    function EvidenceRail({ data, filter, onOpenEntity, onOpenMode }) {
      const index = data.index
      const req = filter === null ? null : index.reqs.find((row) => row.id === filter) ?? null
      const reqEntity = filter === null ? null : data.entities.get(filter)
      const tests = req === null ? index.tests : index.tests.filter((test) => test.reqId === req.id)
      const testsWithEvidence = tests.filter((test) => evidenceCountOf(data, test) > 0)
      const testsWithoutEvidence = tests.length - testsWithEvidence.length
      const reqsWithoutTests = index.reqs.filter((row) => row.tests.length === 0).length
      const shown = (req === null ? testsWithEvidence : tests).slice(0, 8)

      return h('aside', { className: 'ps-evrail', 'aria-label': 'Evidence rail' },
        h('div', { className: 'ps-railhead' },
          h('h2', { className: 'ps-kicker' }, 'Evidence rail'),
          h('span', { className: 'ps-spacer' }),
          req === null ? null : h('button', { type: 'button', className: 'ps-btn small', onClick: () => onOpenEntity(req.id) }, 'Open detail'),
        ),
        req === null
          ? h('div', { className: 'ps-railreq' },
              h('p', { className: 'ps-kicker' }, 'This view'),
              h('p', { className: 't' }, 'Evidence across the projections'),
              h('p', { className: 'ps-meta' }, 'Choose a requirement in Requirements to pin its evidence here.'),
            )
          : h('div', { className: 'ps-railreq' },
              h(TypeChip, { kind: 'req', id: req.id, static: true }),
              h('p', { className: 't' }, titleOf(reqEntity, req.id)),
              h('p', { className: 'ps-meta' }, `${req.tasks.length} task${req.tasks.length === 1 ? '' : 's'} · ${req.tests.length} test${req.tests.length === 1 ? '' : 's'} · ${req.decisions.length} decision${req.decisions.length === 1 ? '' : 's'}`),
            ),
        h('div', { className: 'ps-evsum', 'aria-label': 'Evidence totals' },
          h('div', { className: 'cell' }, h('span', { className: 'n' }, String(testsWithEvidence.length)), h('span', { className: 'l' }, `test${testsWithEvidence.length === 1 ? '' : 's'} with evidence`)),
          h('div', { className: 'cell' }, h('span', { className: 'n' }, String(testsWithoutEvidence)), h('span', { className: 'l' }, `test${testsWithoutEvidence === 1 ? '' : 's'} without evidence`)),
        ),
        h('div', { className: 'ps-railsec' },
          h('h3', null, req === null ? 'Tests carrying evidence' : `Tests for ${req.id} (${tests.length})`),
          shown.length === 0
            ? h('p', { className: 'ps-muted' }, req === null
                ? 'No test in these projections carries an evidence reference. The Tests & trace mode shows every TEST row.'
                : h(Gap, { onClick: () => onOpenMode('trace', req.id) }, 'no test'), req === null ? null : ' This requirement has no test in the projections.')
            : shown.map((test) => {
                const entity = data.entities.get(test.id)
                const fm = entity?.frontmatter ?? {}
                const refs = evidenceCountOf(data, test)
                return h('div', { className: 'ps-evrow', key: test.id },
                  h(TypeChip, { kind: 'test', id: test.id, onClick: () => onOpenEntity(test.id), title: `Open test ${test.id}` }),
                  h(Status, { status: test.status }),
                  h('span', { className: 'ps-meta' }, refs > 0 ? `${refs} evidence ref${refs === 1 ? '' : 's'}` : 'no evidence'),
                  typeof fm.command === 'string' && fm.command !== '' ? h('span', { className: 'cmd', title: fm.command }, fm.command) : null,
                )
              }),
        ),
        req !== null && req.decisions.length > 0
          ? h('div', { className: 'ps-railsec' },
              h('h3', null, `Decisions (${req.decisions.length})`),
              h('div', { className: 'ps-chiplist' }, req.decisions.map((id) => h(TypeChip, { key: id, kind: 'decision', id, onClick: () => onOpenEntity(id) }))),
            )
          : null,
        h('div', { className: 'ps-railsec' },
          h('h3', null, 'Evidence gaps'),
          h('p', { className: 'ps-muted' }, `${reqsWithoutTests} requirement${reqsWithoutTests === 1 ? '' : 's'} without a test in the projections.`),
          req === null
            ? h('p', { className: 'ps-muted' }, `${testsWithoutEvidence} test${testsWithoutEvidence === 1 ? '' : 's'} without an evidence reference; open a test to read its recorded pair.`)
            : h('p', { className: 'ps-muted' }, `${testsWithoutEvidence} of ${tests.length} tests for this requirement carry no evidence reference.`),
        ),
        h('p', { className: 'ps-railnote' }, 'Evidence is read from index.json and the TEST entity body. The red→green pair is shown in the test drawer, not summarised here.'),
      )
    }

    function Drawer({ drawer, data, analysisLinks, filter, onClose, onOpenEntity, onOpenRequirement, onOpenMode, onClearFilter, tab, setTab }) {
      const closeRef = useRef(null)
      const isNode = drawer.kind === 'node'
      const entity = isNode ? null : data.entities.get(drawer.id)
      const fm = entity?.frontmatter ?? {}
      const node = drawer.node ?? null
      const title = isNode ? (node?.label || node?.id || drawer.id) : titleOf(entity, drawer.id)
      const status = isNode ? null : fm.status ?? (drawer.kind === 'req' ? data.index.reqs.find((row) => row.id === drawer.id)?.status : null)
      const kindLabel = KIND_NAME[drawer.kind] ?? drawer.kind

      useEffect(() => {
        if (closeRef.current !== null) closeRef.current.focus()
      }, [drawer.id, drawer.kind])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
      }, [onClose])

      const revision = fm.revision === undefined ? null : String(fm.revision)
      const updatedAt = typeof fm.updatedAt === 'string' ? fm.updatedAt : null
      const indexRow = isNode ? null : drawer.kind === 'task'
        ? data.index.tasks.find((row) => row.id === drawer.id)
        : drawer.kind === 'test'
          ? data.index.tests.find((row) => row.id === drawer.id)
          : drawer.kind === 'req'
            ? data.index.reqs.find((row) => row.id === drawer.id)
            : null
      const requirementId = indexRow?.reqId ?? (typeof fm.reqId === 'string' ? fm.reqId : null)
      const evidenceRefs = indexRow !== null && Array.isArray(indexRow.evidenceRefs) ? indexRow.evidenceRefs : []
      const extraEvidence = Array.isArray(fm.evidenceRefs) ? fm.evidenceRefs : []

      return h('aside', { className: 'ps-drawer', 'aria-labelledby': 'ps-drawer-title' },
        h('div', { className: 'ps-drawerhead' },
          h('div', { className: 'grow' },
            h('p', { className: 'ps-kicker' }, kindLabel),
            h('h2', { id: 'ps-drawer-title' }, title),
          ),
          h('button', { ref: closeRef, type: 'button', className: 'ps-btn close icon', onClick: onClose, title: 'Close details (Escape)', 'aria-label': 'Close details' }, '✕'),
        ),
        h('div', { className: 'ps-rowmeta', style: { marginTop: -2, marginBottom: 10 } },
          isNode
            ? h('span', { className: 'ps-chip static', style: { '--ps-type': TYPE_COLOR.node } }, h('span', { className: 'mark' }), h('code', null, String(node?.id ?? drawer.id)))
            : h(TypeChip, { kind: drawer.kind, id: drawer.id, static: true }),
          status === null ? null : h(Status, { status }),
          revision === null ? null : h('span', { className: 'ps-meta' }, `revision ${revision}`),
        ),
        h('div', { className: 'ps-group', role: 'tablist', 'aria-label': 'Entity detail sections', style: { marginBottom: 10 } },
          h('button', { type: 'button', role: 'tab', id: 'ps-dtab-overview', 'aria-selected': tab === 'overview', 'aria-controls': 'ps-drawer-panel', className: tab === 'overview' ? 'on' : '', onClick: () => setTab('overview') }, 'Overview'),
          h('button', { type: 'button', role: 'tab', id: 'ps-dtab-links', 'aria-selected': tab === 'links', 'aria-controls': 'ps-drawer-panel', className: tab === 'links' ? 'on' : '', onClick: () => setTab('links') }, 'Links'),
        ),
        h('div', { id: 'ps-drawer-panel', role: 'tabpanel', 'aria-labelledby': tab === 'overview' ? 'ps-dtab-overview' : 'ps-dtab-links' },
          tab === 'links'
            ? h(EntityLinks, { kind: drawer.kind, id: drawer.id, filter, data, analysisLinks, node, onOpenEntity, onOpenRequirement, onOpenMode, onCloseFilter: onClearFilter })
            : isNode
              ? h('div', null,
                  h('div', { className: 'ps-sec' },
                    h('h3', null, 'Scene facts'),
                    h('dl', { className: 'ps-nodefacts' },
                      h('dt', null, 'Node'), h('dd', null, String(node?.id ?? '—')),
                      h('dt', null, 'Type'), h('dd', null, String(node?.type ?? '—')),
                      h('dt', null, 'Source'), h('dd', null, String(node?.source ?? 'no source path')),
                      h('dt', null, 'View'), h('dd', null, String(drawer.view?.view?.title || drawer.view?.view?.viewId || '—')),
                    ),
                    node?.stale === true ? h('p', { className: 'muted' }, 'This node is marked stale by designmap: the source file changed after the scene was rendered.') : null,
                  ),
                  h('p', { className: 'muted' }, 'The node is a design-map node, not a state entity. Its requirement links come from the analysis trace; open Links to follow them.'),
                )
              : h('div', null,
                  h('div', { className: 'ps-sec' },
                    h('h3', null, 'Overview'),
                    drawer.kind === 'task' || drawer.kind === 'test'
                      ? h('p', { className: 'ps-chiplist', style: { marginBottom: 6 } },
                          h('span', { className: 'muted' }, 'Requirement: '),
                          requirementId
                            ? h(TypeChip, { kind: 'req', id: requirementId, onClick: () => onOpenEntity(requirementId) })
                            : h(Gap, { static: true }, drawer.kind === 'task' ? 'no requirement' : 'no requirement'),
                        )
                      : null,
                    drawer.kind === 'task'
                      ? h('p', { className: 'ps-chiplist', style: { marginBottom: 6 } },
                          h('span', { className: 'muted' }, 'Tests: '),
                          (() => {
                            const tests = data.index.tests.filter((row) => Array.isArray(row.evidenceRefs) && row.evidenceRefs.some((ref) => ref.kind === 'task' && ref.id === drawer.id))
                            return tests.length > 0
                              ? tests.map((row) => h(TypeChip, { key: row.id, kind: 'test', id: row.id, onClick: () => onOpenEntity(row.id) }))
                              : h('span', { className: 'muted' }, 'none linked as evidence')
                          })(),
                        )
                      : null,
                    drawer.kind === 'test' && (evidenceRefs.length > 0 || extraEvidence.length > 0)
                      ? h('p', { className: 'ps-chiplist', style: { marginBottom: 6 } },
                          h('span', { className: 'muted' }, 'Evidence: '),
                          evidenceRefs.map((ref, position) => h(TypeChip, {
                            key: `${ref.id}-${position}`,
                            kind: kindOfId(ref.id),
                            id: ref.id,
                            title: `${ref.kind ?? kindOfId(ref.id)} ${ref.id}; ${shortHash(ref.hash)}`,
                            onClick: data.entities.has(ref.id) ? () => onOpenEntity(ref.id) : undefined,
                            static: !data.entities.has(ref.id),
                          })),
                          extraEvidence.map((id, position) => h(TypeChip, {
                            key: `${id}-extra-${position}`,
                            kind: kindOfId(id),
                            id,
                            onClick: data.entities.has(id) ? () => onOpenEntity(id) : undefined,
                            static: !data.entities.has(id),
                          })),
                        )
                      : null,
                    drawer.kind === 'decision'
                      ? h('p', { className: 'ps-chiplist', style: { marginBottom: 6 } },
                          h('span', { className: 'muted' }, 'Requirements: '),
                          (() => {
                            const reqIds = data.index.reqs.filter((row) => row.decisions.includes(drawer.id)).map((row) => row.id)
                            return reqIds.length > 0 ? reqIds.map((id) => h(TypeChip, { key: id, kind: 'req', id, onClick: () => onOpenEntity(id) })) : h('span', { className: 'muted' }, 'none linked')
                          })(),
                        )
                      : null,
                    drawer.kind === 'req'
                      ? (Array.isArray(fm.criteria) && fm.criteria.length > 0
                          ? h('ol', { className: 'ps-criteria', style: { color: 'var(--ps-ink)' } }, fm.criteria.map((criterion, position) => h('li', { key: position }, String(criterion))))
                          : h('p', { className: 'muted' }, h(Gap, { static: true }, 'no criteria'), ' The state core rejects acceptance without criteria (`req_criteria_missing`).'))
                      : null,
                    drawer.kind === 'task' && fm.reqId === undefined && fm.chore !== true
                      ? h('p', { className: 'muted' }, h(Gap, { static: true }, 'no requirement'), ' The state core reports `task_req_missing` for a non-chore task.')
                      : null,
                    drawer.kind === 'task' && fm.chore === true ? h('p', null, h('b', null, 'Chore: '), String(fm.choreReason ?? 'reason not recorded')) : null,
                    drawer.kind === 'test'
                      ? h('dl', { className: 'ps-defs' },
                          h('dt', null, 'Command'), h('dd', null, typeof fm.command === 'string' && fm.command !== '' ? h('code', { className: 'ps-code' }, fm.command) : 'not recorded'),
                          h('dt', null, 'Author role'), h('dd', null, String(fm.authorRole ?? 'not recorded')),
                        )
                      : null,
                    fm.analysisRef !== undefined && fm.analysisRef !== null
                      ? h('p', { className: 'muted', style: { marginTop: 6 } }, `Analysis: ${String(fm.analysisRef.initiative ?? '')} / ${String(fm.analysisRef.requirementId ?? '')}`)
                      : null,
                    entity?.error !== undefined ? h('p', { className: 'muted' }, `The entity file could not be read (${entity.error}); the index row is shown.`) : null,
                  ),
                  entity !== null && typeof entity.body === 'string' && entity.body !== ''
                    ? h('div', { className: 'ps-sec' },
                        h('h3', null, drawer.kind === 'test' ? 'Recorded evidence' : 'Body'),
                        drawer.kind === 'test'
                          ? h(EvidenceBlock, { text: entity.body })
                          : h('pre', { className: 'ps-pre' }, entity.body),
                      )
                    : drawer.kind === 'test'
                      ? h('div', { className: 'ps-sec' }, h('h3', null, 'Recorded evidence'), h('p', { className: 'muted' }, h(Gap, { static: true }, 'no red→green pair recorded'), ' A green result without a red run is not evidence; the state core refuses closure with `evidence_required`.'))
                      : null,
                  updatedAt !== null
                    ? h('p', { className: 'ps-meta' }, `Updated ${updatedAt}${fm.createdAt === undefined ? '' : ` · created ${String(fm.createdAt)}`}`)
                    : null,
                ),
        ),
      )
    }

    /* ---------- page ---------- */

    function sessionsOfWorkspace(workspace) {
      return Array.isArray(workspace?.sessionIds) ? workspace.sessionIds.filter((id) => typeof id === 'string' && id !== '') : []
    }

    function pickSession(workspaces, sessionsById) {
      let stored = null
      try {
        stored = sessionStorage.getItem(SESSION_KEY)
      } catch {
        stored = null
      }
      const storedLive = typeof stored === 'string' && stored !== '' && sessionsById?.[stored] !== undefined && (sessionsById[stored]?.retainedBy?.mainView ?? 0) > 0
      if (storedLive) return stored
      const candidates = (Array.isArray(workspaces) ? workspaces : []).filter((workspace) => sessionsOfWorkspace(workspace).length > 0)
        .slice()
        .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')))
      for (const workspace of candidates) {
        const ids = sessionsOfWorkspace(workspace)
        const live = ids.find((id) => (sessionsById?.[id]?.retainedBy?.mainView ?? 0) > 0)
        if (live !== undefined) return live
      }
      if (typeof stored === 'string' && stored !== '' && sessionsById?.[stored] !== undefined) return stored
      return candidates[0] === undefined ? null : sessionsOfWorkspace(candidates[0])[0] ?? null
    }

    class PanelBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error, info) {
        console.error('[project-state-panel] render failed:', error, info?.componentStack ?? '')
      }
      render() {
        if (this.state.error === null) return this.props.children
        return h('div', { className: 'ps-root', role: 'main', 'aria-label': 'Project state' },
          h('div', { role: 'alert', style: { padding: 16 } },
          h('h1', { className: 'ps-title' }, 'Project state panel failed'),
          h('p', null, 'The projections were not drawn. The error is below and in the browser console.'),
          h('pre', { className: 'ps-pre' }, String(this.state.error?.message ?? this.state.error)),
          ),
        )
      }
    }

    function BackIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M14.5 5.5 8 12l6.5 6.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function SidebarToggleIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M9.5 4.5v15', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M6 9.5h1.5M6 12h1.5M6 14.5h1.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      )
    }

    function RightbarCloseIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M15 4.5v15', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M17 9.5l4 4m0-4l-4 4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      )
    }

    function ProjectStatePage(props) {
      const remote = props.remote
      const sessionsById = props.useSessions === undefined ? {} : props.useSessions((snapshot) => snapshot.byId)
      const workspaces = props.useWorkspaces === undefined ? [] : props.useWorkspaces((snapshot) => snapshot.items)
      const sessionId = useMemo(() => pickSession(workspaces, sessionsById), [workspaces, sessionsById])
      const [mode, setModeState] = useState('req')
      const [filter, setFilter] = useState(null)
      const [subview, setSubview] = useState('tests')
      const [reloadToken, setReloadToken] = useState(0)
      const [data, setData] = useState({ phase: 'loading' })
      const [drawer, setDrawer] = useState(null)
      const [drawerTab, setDrawerTab] = useState('overview')
      const [map, setMap] = useState({ phase: 'idle' })
      const [viewId, setViewId] = useState(null)
      const [mapReload, setMapReload] = useState(0)
      const returnFocus = useRef(null)

      useEffect(() => {
        setFilter(null)
        setDrawer(null)
        setMap({ phase: 'idle' })
        setViewId(null)
      }, [sessionId])

      useEffect(() => {
        if (sessionId === null || sessionId === undefined || sessionId === '') {
          setData({ phase: 'no-session' })
          return undefined
        }
        const controller = new AbortController()
        setData((previous) => (previous.phase === 'ready' ? { ...previous, phase: 'refreshing' } : { phase: 'loading' }))
        loadWorkspace(remote, sessionId, controller.signal).then(
          (next) => {
            if (!controller.signal.aborted) setData(next)
          },
          (error) => {
            if (!controller.signal.aborted) setData({ phase: 'error', code: 'load_failed', message: errorText(error) })
          },
        )
        return () => controller.abort()
      }, [remote, sessionId, reloadToken])

      useEffect(() => {
        if (mode !== 'map' || sessionId === null || sessionId === undefined) return undefined
        let cancelled = false
        setMap((previous) => ({ ...previous, phase: 'loading', error: null }))
        loadMapViews(remote, sessionId).then(
          (result) => {
            if (cancelled) return
            if (result.ok !== true) {
              setMap({ phase: 'error', code: result.code, message: result.message })
              return
            }
            setMap({ phase: 'ready', payload: result.payload })
            setViewId((current) => current ?? result.payload.rootId ?? result.payload.views[0]?.view?.viewId ?? null)
          },
          (error) => {
            if (!cancelled) setMap({ phase: 'error', code: 'map_load_failed', message: errorText(error) })
          },
        )
        return () => { cancelled = true }
      }, [mode, sessionId, mapReload, remote])

      const analysisLinks = useMemo(() => (data.phase === 'ready' ? buildAnalysisLinks(data.analysis, data.entities) : null), [data])

      const setMode = useCallback((next) => {
        setModeState(next)
      }, [])

      const openMode = useCallback((nextMode, reqId) => {
        if (typeof reqId === 'string' && reqId !== '') setFilter(reqId)
        setModeState(nextMode)
      }, [])

      const openEntity = useCallback((id) => {
        const kind = kindOfId(id)
        returnFocus.current = document.activeElement
        setDrawer({ kind, id })
        setDrawerTab('overview')
        if (kind === 'req') setFilter(id)
      }, [])

      const openNode = useCallback((node, view) => {
        returnFocus.current = document.activeElement
        setDrawer({ kind: 'node', id: node.id, node, view })
        setDrawerTab('overview')
      }, [])

      const closeDrawer = useCallback(() => {
        setDrawer(null)
        const target = returnFocus.current
        if (target !== null && typeof target.focus === 'function') window.setTimeout(() => target.focus(), 0)
      }, [])

      const clearFilter = useCallback(() => setFilter(null), [])

      const onModeKeyDown = (event) => {
        // The mode list is a VERTICAL tablist in the Night desk shell; keep the horizontal
        // arrows working for muscle memory, but Up/Down is the pattern the orientation promises.
        const order = ['req', 'board', 'map', 'trace']
        const index = order.indexOf(mode)
        const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
        if (delta !== 0) {
          event.preventDefault()
          const next = order[(index + delta + order.length) % order.length]
          setMode(next)
          const element = document.getElementById(`ps-tab-${next}`)
          if (element !== null) element.focus()
        }
      }

      if (data.phase === 'no-session') {
        return h('div', { className: 'ps-root', role: 'main', 'aria-label': 'Project state' },
          h('style', null, CSS),
          h('div', { className: 'ps-top' }, h('h1', { className: 'ps-title' }, 'Project state'), h('span', { className: 'ps-spacer' }), h('span', { className: 'ps-ro', title: 'This panel executes no write command and writes no file.' }, 'read-only')),
          h('div', { className: 'ps-main' },
            h(Empty, { title: 'Open a live conversation' }, h('p', null, 'The panel reads the projections of the workspace the conversation belongs to. There is no live conversation to anchor that workspace.')),
          ),
        )
      }

      const ready = data.phase === 'ready' || data.phase === 'refreshing'
      const index = ready ? data.index : null
      const counts = index === null ? null : {
        req: index.reqs.length,
        task: index.tasks.length,
        test: index.tests.length,
        decision: index.decisions.length,
      }
      const filteredTasks = index === null || filter === null ? null : index.tasks.filter((task) => task.reqId === filter).length
      const filteredTests = index === null || filter === null ? null : index.tests.filter((test) => test.reqId === filter).length

      const modeButton = (id, label) => h('button', {
        id: `ps-tab-${id}`,
        type: 'button',
        role: 'tab',
        'aria-selected': mode === id,
        'aria-controls': 'ps-panel',
        className: 'ps-mode',
        onClick: () => setMode(id),
        onKeyDown: onModeKeyDown,
        tabIndex: mode === id ? 0 : -1,
      }, label)

      const filterEntity = filter === null ? null : data.entities.get(filter)
      const filterTitle = filter === null ? '' : titleOf(filterEntity, filter)

      return h('div', { className: 'ps-root', role: 'main', 'aria-label': 'Project state' },
        h('style', null, CSS),
        h('div', { className: 'ps-top' },
          h('button', { type: 'button', className: 'ps-btn icon ps-back', onClick: () => props.layout.selectPanel(null), title: 'Back to chat', 'aria-label': 'Back to chat' }, h(BackIcon, { size: 16 })),
          h('h1', { className: 'ps-title' }, 'Project state'),
          h('span', { className: 'ps-ro', title: 'This panel executes no write command and writes no file. Changes stay in the Tasks, Cases and Design map panels and in the state core.' }, 'read-only'),
          h('span', { className: 'ps-spacer' }),
          counts === null ? null : h('div', { className: 'ps-counts', 'aria-label': 'Projection counts' },
            h('span', { className: 'ps-count', title: 'Requirements in index.json' }, h('b', null, String(counts.req)), 'REQ'),
            h('span', { className: 'ps-count', title: 'Tasks in index.json' }, h('b', null, String(counts.task)), 'TASK'),
            h('span', { className: 'ps-count', title: 'Tests in index.json' }, h('b', null, String(counts.test)), 'TEST'),
            h('span', { className: 'ps-count', title: 'Decisions in index.json' }, h('b', null, String(counts.decision)), 'DEC'),
          ),
          index === null ? null : h('span', { className: 'ps-meta', title: 'The machine-readable link contract this panel reads' }, `index.json v${index.schemaVersion} · event ${String(index.lastSeq ?? 0)}`),
          h('div', { className: 'ps-windowgroup', role: 'group', 'aria-label': 'Window controls' },
            h('button', { type: 'button', className: 'ps-btn icon', onClick: () => props.layout.toggleSidebar(), title: 'Toggle left sidebar', 'aria-label': 'Toggle left sidebar' }, h(SidebarToggleIcon, { size: 16 })),
            h('button', {
              type: 'button',
              className: 'ps-btn icon',
              onClick: () => {
                // layout.closeRightbar only reports the frame presentation; the rightbar's
                // own expanded state is owned by sidebarRight and reopens it on return.
                // Collapse that state too, or the control is a no-op after Back to chat.
                props.layout.closeRightbar()
                const actions = props.sidebarRight?.actionsFor?.(sessionId)
                if (actions?.setExpanded && typeof sessionId === 'string') actions.setExpanded(sessionId, false)
              },
              title: 'Close right sidebar',
              'aria-label': 'Close right sidebar',
            }, h(RightbarCloseIcon, { size: 16 })),
          ),
          h('button', { type: 'button', className: 'ps-btn small', onClick: () => setReloadToken((value) => value + 1), disabled: data.phase === 'loading' || data.phase === 'refreshing', title: 'Re-read state/views and the entity files' }, 'Reload'),
        ),
        filter === null ? null : h('div', { className: 'ps-filterbar', role: 'status' },
          h(TypeChip, { kind: 'req', id: filter, static: true }),
          h('b', null, 'filters the other modes'),
          filteredTasks === null ? null : h('span', { className: 'ps-meta' }, `${filteredTasks} task${filteredTasks === 1 ? '' : 's'} · ${filteredTests} test${filteredTests === 1 ? '' : 's'}`),
          h('span', { className: 'ps-spacer' }),
          h('button', { type: 'button', className: 'ps-btn small', onClick: clearFilter, title: 'Show every mode without the requirement filter' }, 'Clear filter'),
        ),
        data.phase === 'refreshing' ? h('div', { className: 'ps-filterbar' }, h('span', { className: 'ps-loading' }, 'Reloading the projections…')) : null,
        !ready && data.phase === 'loading' ? h('div', { className: 'ps-main' }, h('p', { className: 'ps-loading' }, 'Reading state/views/index.json…')) : null,
        data.phase === 'empty' ? h('div', { className: 'ps-main' },
          h(Empty, { title: 'No generated projections in this workspace', onReload: () => setReloadToken((value) => value + 1) },
            h('p', null, 'Expected ', h('code', null, 'state/views/index.json'), '. The state core writes the projections with ', h('code', null, 'regenerateViews()'), '; this panel never creates them.'),
            h('p', null, 'Until then the Requirements, Board, Design map and Tests & trace modes have nothing to read.'),
          ),
        ) : null,
        data.phase === 'error' ? h('div', { className: 'ps-main' },
          h(Alert, { code: data.code }, data.message),
          h('p', { className: 'ps-muted' }, 'The panel shows the named failure instead of guessing. Reload after the projections are regenerated.'),
          h('button', { type: 'button', className: 'ps-btn small', onClick: () => setReloadToken((value) => value + 1) }, 'Reload'),
        ) : null,
        ready ? h('div', { className: 'ps-shell' },
          h('nav', { className: 'ps-nav', 'aria-label': 'Project state modes' },
            h('p', { className: 'ps-kicker' }, 'Modes'),
            h('div', { className: 'ps-modes', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Project state modes' },
              modeButton('req', 'Requirements'),
              modeButton('board', 'Board'),
              modeButton('map', 'Design map'),
              modeButton('trace', 'Tests & trace'),
            ),
            h('div', { className: 'ps-navsec' },
              h('p', { className: 'ps-kicker' }, 'Requirement filter'),
              filter === null
                ? h('p', { className: 'muted' }, 'Choose a requirement in Requirements to filter the other modes.')
                : h('div', { className: 'ps-navfilter' },
                    h(TypeChip, { kind: 'req', id: filter, static: true }),
                    h('p', { className: 't' }, filterTitle),
                    h('span', { className: 'ps-meta' }, `${filteredTasks} task${filteredTasks === 1 ? '' : 's'} · ${filteredTests} test${filteredTests === 1 ? '' : 's'}`),
                    h('button', { type: 'button', className: 'ps-btn small', onClick: clearFilter, style: { marginTop: 7 } }, 'Clear filter'),
                  ),
            ),
            h('div', { className: 'ps-navfoot' },
              h('p', { className: 'ps-kicker' }, 'Projection'),
              index === null ? null : h('p', null, `index.json v${index.schemaVersion}`, h('br'), `event ${String(index.lastSeq ?? 0)}`),
              h('p', { style: { marginTop: 6 } }, 'Read-only lens over state/views.'),
            ),
          ),
          h('section', { className: 'ps-main', id: 'ps-panel', role: 'tabpanel', 'aria-labelledby': `ps-tab-${mode}` },
            data.issues !== undefined && data.issues.length > 0 ? h('div', { className: 'ps-warnline', role: 'status' }, `Entity metadata issues: ${data.issues.join('; ')}`) : null,
            mode === 'req'
              ? h(RequirementsMode, { data, filter, onSelect: setFilter, onOpenMode: openMode, onOpenEntityDrawer: openEntity })
              : mode === 'board'
                ? h(BoardMode, { data, filter, onOpenTask: openEntity, onClearFilter: clearFilter })
                : mode === 'map'
                  ? h(MapMode, {
                      data,
                      analysisLinks,
                      map,
                      viewId,
                      onView: setViewId,
                      filter,
                      onOpenNode: openNode,
                      onReload: () => setMapReload((value) => value + 1),
                      onSelectReq: (reqId) => { setFilter(reqId); setModeState('req') },
                    })
                  : h(TestsMode, { data, filter, subview, setSubview, onOpenTest: openEntity, onSelectReq: setFilter, onOpenMode: openMode }),
          ),
          h('div', { className: 'ps-rail' },
            drawer === null
              ? h(EvidenceRail, { data, filter, onOpenEntity: (id) => { openEntity(id); setDrawerTab('overview') }, onOpenMode: openMode })
              : h(Drawer, {
                  drawer,
                  data,
                  analysisLinks,
                  filter,
                  onClose: closeDrawer,
                  onOpenEntity: (id) => { openEntity(id); if (kindOfId(id) !== 'req') setDrawerTab('links') },
                  onOpenRequirement: (id) => { openEntity(id); setModeState('req') },
                  onOpenMode: openMode,
                  onClearFilter: clearFilter,
                  tab: drawerTab,
                  setTab: setDrawerTab,
                }),
          ),
        ) : null,
        h('p', { className: 'ps-visually-hidden', 'aria-live': 'polite' },
          filter === null ? 'No requirement filter.' : `Filtered by ${filter}.`,
        ),
      )
    }

    /* ---------- shell registration ---------- */

    function PanelTrigger({ layout, sessionId }) {
      return h('button', {
        type: 'button',
        title: 'Open the project state panel for this chat',
        'aria-label': 'Open the project state panel',
        style: { display: 'inline-flex', alignItems: 'center', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', borderRadius: 7, minHeight: 24, padding: '3px 8px', font: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' },
        onClick: () => {
          try {
            if (typeof sessionId === 'string' && sessionId !== '') sessionStorage.setItem(SESSION_KEY, sessionId)
          } catch {
            /* private mode: the panel falls back to the live session */
          }
          layout.selectPanel(PANEL_ID)
        },
      }, 'State')
    }

    return {
      inject: ['slots', 'remote', 'remote.workspaceFiles', 'remote.commands', 'layout', 'sidebarRight'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ remote: ctx.remote, layout: ctx.layout, sidebarRight: ctx.sidebarRight }),
        }, ProjectStatePage))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'project-state',
          order: 15,
          inject: (sessionId) => ({ layout: ctx.layout, sessionId }),
        }, PanelTrigger))
      },
    }
  },
})
