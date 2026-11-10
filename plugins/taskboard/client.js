window.__ModuleLoader__.load({
  id: '@cc/dsh-taskboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState, useSyncExternalStore } = React

    const PANEL_ID = 'tasks'
    const FILE = '.dsh/taskboard.json'
    // Seven states, no two of them the same thing. `proposed` and `ready` were two names
    // for "not started"; rows that still say so are mapped to `open` on READ, never
    // rewritten (see mapStatus).
    const STATUSES = ['open', 'active', 'paused', 'review', 'done', 'blocked', 'cancelled']
    const LEGACY_STATUS = { proposed: 'open', ready: 'open' }
    /**
     * Five board columns, not eight. The board answers "where is this work", so the two
     * states that are not stages share a column with the stage they belong to: `paused`
     * sits under Active (the card chip still says paused) and `cancelled` under Done (the
     * chip still says cancelled). The List view and the status filter keep all seven.
     */
    const COLUMNS = [
      { id: 'open', label: 'Open', statuses: ['open'] },
      { id: 'active', label: 'Active', statuses: ['active', 'paused'] },
      { id: 'review', label: 'Review', statuses: ['review'] },
      { id: 'blocked', label: 'Blocked', statuses: ['blocked'] },
      { id: 'done', label: 'Done', statuses: ['done', 'cancelled'] },
    ]

    const CSS = `
.tb-root{--tb-primary-fill:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));--tb-primary-label:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-label-primary-inverted));height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;container-type:inline-size}
.tb-root *{box-sizing:border-box}
.tb-top{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;min-height:48px;flex-wrap:wrap}
.tb-title{font-size:16px;font-weight:700;letter-spacing:-.01em;margin:0}
.tb-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--tb-primary-fill);color:var(--tb-primary-label);font-size:10.5px;font-weight:700}
.tb-spacer{flex:1}
.tb-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:5px 9px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.tb-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.tb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tb-btn.primary{background:var(--tb-primary-fill);border-color:var(--tb-primary-fill);color:var(--tb-primary-label)}
.tb-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,var(--tb-primary-fill));border-color:var(--dsw-alias-button-primary-hover,var(--tb-primary-fill))}
.tb-btn:disabled{opacity:.55;cursor:not-allowed}
.tb-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1))}
.tb-select{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:7px;padding:5px 24px 5px 8px;font:inherit;font-size:12px;max-width:190px;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-secondary) 50%),linear-gradient(135deg,var(--dsw-alias-label-secondary) 50%,transparent 50%);background-position:calc(100% - 13px) 50%,calc(100% - 9px) 50%;background-size:4px 4px,4px 4px;background-repeat:no-repeat;cursor:pointer}
.tb-body{display:grid;grid-template-columns:minmax(0,1fr) 400px;flex:1;min-height:0}
.tb-body.solo{grid-template-columns:minmax(0,1fr)}
.tb-board{display:flex;gap:9px;padding:11px;overflow:auto;min-width:0;align-items:flex-start;scrollbar-width:thin;overscroll-behavior:contain}
.tb-col{min-width:184px;flex:1 0 184px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px;min-height:120px}
.tb-col h3{display:flex;align-items:center;gap:6px;margin:0 0 7px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);font-weight:700}
.tb-col h3 .n{margin-left:auto;color:var(--dsw-alias-label-secondary);font-weight:500;letter-spacing:0}
.tb-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px;margin-bottom:7px;cursor:pointer;box-shadow:0 1px 0 rgba(0,0,0,.03)}
.tb-card:hover{background:var(--dsw-alias-bg-layer-2)}
.tb-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tb-card.sel{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent)}
.tb-card .t{font-size:12.4px;font-weight:650;line-height:1.3;margin-bottom:4px;overflow-wrap:anywhere}
.tb-card .s{font-size:10.8px;color:var(--dsw-alias-label-secondary);margin-bottom:6px;overflow-wrap:anywhere}
.tb-chips{display:flex;flex-wrap:wrap;gap:3px}
.tb-chip{display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 6px;font-size:10px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 7%,transparent);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-chip.ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.tb-chip.warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.tb-chip.bad{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}
.tb-card .f{display:flex;align-items:center;gap:5px;margin-top:6px;padding-top:5px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10px;min-width:0}
.tb-card .f .o{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-avatar{width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);color:var(--dsw-alias-brand-primary);font-size:8.5px;font-weight:800;flex:none}
.tb-detail{border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);overflow:auto;min-height:0;min-width:0;padding:12px 14px 24px;scrollbar-width:thin}
.tb-kicker{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.tb-detail h2{font-size:15px;line-height:1.25;margin:0 0 7px;overflow-wrap:anywhere}
.tb-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.tb-sec{margin:0 0 11px}
.tb-sec h4{margin:0 0 3px;font-size:10px;letter-spacing:.11em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.tb-sec p{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
.tb-input,.tb-area{width:100%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:5px 7px;font:inherit;font-size:12px}
.tb-input:focus,.tb-area:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:0;border-color:transparent}
.tb-area{min-height:96px;resize:vertical;line-height:1.4}
.tb-area.small{min-height:84px}
.tb-label{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:6px 0 2px}
.tb-timeline{list-style:none;margin:0;padding:0;position:relative}
.tb-timeline:before{content:"";position:absolute;left:6px;top:4px;bottom:4px;width:1px;background:var(--dsw-alias-border-l1)}
.tb-ev{position:relative;padding:0 0 9px 19px}
.tb-ev:last-child{padding-bottom:0}
.tb-ev .b{position:absolute;left:1px;top:3px;width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);border:2px solid var(--dsw-alias-brand-primary)}
.tb-ev.ok .b{border-color:var(--dsw-alias-state-success-primary)}
.tb-ev.warn .b{border-color:var(--dsw-alias-state-warn-primary)}
.tb-ev.bad .b{border-color:var(--dsw-alias-state-error-primary)}
.tb-ev .who{font-size:11.2px;font-weight:650}
.tb-ev .what{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.tb-ev .when{font-size:9.8px;color:var(--dsw-alias-label-secondary);opacity:.8;margin-top:1px}
.tb-empty{padding:26px 18px;color:var(--dsw-alias-label-secondary);font-size:12.5px;text-align:center}
.tb-banner{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:7px;padding:6px 8px;margin:0 0 9px;font-size:11.5px;overflow-wrap:anywhere}
.tb-note{display:flex;gap:5px;margin-top:5px}
.tb-savehint{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin:-3px 0 9px;min-height:14px}
.tb-detail-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:4px}
.tb-detail-head .tb-kicker{flex:1;margin-bottom:0}
.tb-hide{flex:none;padding:2px 8px;font-size:11px;line-height:1.3}
.tb-readonly{flex:none;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent);color:var(--dsw-alias-state-warn-primary);border-radius:7px;padding:6px 10px;margin:8px 14px 0;font-size:11.5px;font-weight:600}
.tb-global-error{flex:none;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent);color:var(--dsw-alias-state-error-primary);border-radius:7px;padding:6px 10px;margin:8px 14px 0;font-size:11.5px;font-weight:600;overflow-wrap:anywhere}
.tb-conflict{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent);color:var(--dsw-alias-state-warn-primary);border-radius:7px;padding:6px 8px;margin:0 0 9px;font-size:11.5px}
.tb-conflict .tb-btn{margin-left:auto;border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 38%,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary)}
.tb-roster{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);min-height:30px}
.tb-roster .tb-rlabel{font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:var(--dsw-alias-label-secondary)}
.tb-roster .tb-rstat{white-space:nowrap}
.tb-roster .tb-rstat b{color:var(--dsw-alias-label-primary);font-weight:700;font-variant-numeric:tabular-nums}
.tb-roster .tb-rsep{opacity:.5}
.tb-roster .tb-rroles{display:flex;align-items:center;gap:4px;flex-wrap:wrap;min-width:0}
.tb-roster .tb-rrole{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:0 6px;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.tb-roster .tb-rrole b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.tb-roster .tb-rnone{font-style:italic}
.tb-subsummary{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin:0 0 5px}
.tb-subs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.tb-sub{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 6px;font-size:11px;background:var(--dsw-alias-bg-base);min-width:0}
.tb-sub .role{flex:none;font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-primary)}
.tb-sub .who{display:flex;flex-direction:column;min-width:0;line-height:1.25}
.tb-sub .label,.tb-sub .id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-sub .id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9px;color:var(--dsw-alias-label-secondary)}
.tb-sub .state{flex:none;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 5px;font-size:9.5px;font-weight:700;text-transform:capitalize;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.tb-sub .state.active{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.tb-sub .state.paused{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.tb-sub .state.stale{color:var(--dsw-alias-label-secondary);border-style:dashed;opacity:.75}
.tb-sub .tb-btn{margin-left:auto;padding:2px 6px;font-size:10px;flex:none}
.tb-chip.sub{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);white-space:normal;overflow:visible;text-overflow:clip;line-height:1.3}
.tb-note .tb-input{flex:1}
.tb-children{display:flex;flex-direction:column;gap:4px}
.tb-child{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:5px 7px;font-size:11px;background:var(--dsw-alias-bg-base);min-width:0}
.tb-child .id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tb-child .tb-btn{margin-left:auto;padding:2px 6px;font-size:10px}
.tb-trigger{display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);border-radius:7px;padding:3px 7px;font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;height:26px}
.tb-trigger:hover{background:var(--dsw-alias-bg-layer-1)}
.tb-trigger:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tb-trigger-label{white-space:nowrap}
.tb-trigger .n{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:17px;padding:0 5px;margin-left:4px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.tb-icon{display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:inherit;border-radius:7px;padding:5px;cursor:pointer}
.tb-icon:hover{background:transparent;color:inherit}
.tb-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.tb-icon.active{background:transparent;color:inherit}
.tb-viewswitch{display:inline-flex;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);flex:none}
.tb-viewbtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:5px 8px;font:inherit;font-size:11px;font-weight:650;cursor:pointer}
.tb-viewbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.tb-viewbtn.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.tb-viewbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.tb-filterbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);flex:none}
.tb-filter{flex:1 1 220px;max-width:360px;min-width:140px}
.tb-statusfilter{max-width:160px}
.tb-filtercount{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.tb-listwrap{overflow:auto;min-height:0;min-width:0;padding:0 12px 24px;scrollbar-width:thin;overscroll-behavior:contain}
.tb-listhead{display:grid;grid-template-columns:76px 170px minmax(0,1fr) 120px 56px;gap:6px;align-items:center;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-base);padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);font-weight:700}
.tb-list{display:flex;flex-direction:column;gap:1px;padding-top:2px}
.tb-listrow{display:grid;grid-template-columns:76px 170px minmax(0,1fr) 120px 56px;gap:6px;align-items:center;width:100%;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);padding:7px 8px;font:inherit;text-align:left;cursor:pointer;border-radius:5px}
.tb-listrow:hover{background:var(--dsw-alias-bg-layer-2)}
.tb-listrow.sel{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
.tb-listrow:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.tb-listrow .tb-chip{justify-self:start;min-width:0;overflow:hidden;text-overflow:ellipsis}
.tb-listtitle{min-width:0;display:flex;flex-direction:column;gap:1px}
.tb-listtitle .t{font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-listtitle .s{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-listrole,.tb-listowner,.tb-listtime{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.tb-listrole{display:flex;align-items:center;gap:4px;overflow:hidden}
.tb-listrole .tb-chip{flex:none}
.tb-listrole .tb-preset{font-size:9.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;min-width:0}
.tb-listrole .tb-kids{font-size:9.5px;color:var(--dsw-alias-label-secondary);flex:none;font-variant-numeric:tabular-nums}
.tb-listtime{text-align:right}
.tb-chip.role{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);font-weight:700}
.tb-chip.inline{border-style:dashed}
.tb-chip.missing{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}
.tb-owner{display:flex;align-items:center;gap:5px;min-width:0}
.tb-policy{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:6px;padding:6px 8px;margin:0 0 9px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.tb-policy b{color:var(--dsw-alias-label-primary);font-weight:650}
@media (max-width:760px){.tb-listhead,.tb-listrow{grid-template-columns:76px 120px minmax(0,1fr);gap:6px}.tb-listhead span:nth-child(4),.tb-listhead span:nth-child(5),.tb-listrow .tb-listowner,.tb-listrow .tb-listtime{display:none}}
@container (max-width:920px){.tb-body{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}.tb-detail{border-left:0;border-top:1px solid var(--dsw-alias-border-l1);max-height:55vh}}
@media (max-width:960px){.tb-body{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}.tb-detail{border-left:0;border-top:1px solid var(--dsw-alias-border-l1);max-height:55vh}}
`

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        getSnapshot: () => state,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set(patch) {
          state = { ...state, ...patch }
          for (const listener of listeners) listener()
        },
      }
    }

    function firstSession(workspaces, sessionsById) {
      const candidates = (Array.isArray(workspaces) ? workspaces : [])
        .filter((workspace) => sessionIdsOf(workspace).length > 0)
        .slice()
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
      const workspace = candidates.find((entry) => sessionIdsOf(entry).some((id) => isLiveSession(sessionsById, id))) ?? candidates[0]
      if (workspace === undefined) return null
      return { sessionId: pickWorkspaceSession(workspace, sessionsById, null), workspace }
    }

    /**
     * The chat a task belongs to - the same rule the Host applies. The recorded chat, or
     * the session that created the row before chats had boards; null means no chat owns
     * it, and only the All-chats view shows it.
     */
    function chatOf(task) {
      if (typeof task?.chatId === 'string' && task.chatId !== '') return task.chatId
      return typeof task?.parentSessionId === 'string' && task.parentSessionId !== '' ? task.parentSessionId : null
    }

    /**
     * The root session of a chat: a child's board is its parent's board, because a
     * delegated child's tasks land on the board the human is reading. The walk is bounded
     * like the Host's and stops at the deepest session the catalog can prove.
     */
    function chatIdOf(sessionId, sessionsById) {
      if (typeof sessionId !== 'string' || sessionId === '') return ''
      let id = sessionId
      for (let hop = 0; hop < 8; hop += 1) {
        const parent = sessionsById?.[id]?.parentId
        if (typeof parent !== 'string' || parent === '') break
        if (sessionsById?.[parent] === undefined) break
        id = parent
      }
      return id
    }

    function isMissing(error) {
      const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase()
      return text.includes('enoent') || text.includes('no such file') || text.includes('no entry at') || text.includes('not found')
    }

    /**
     * The board as the panel READS it: every task carries the status it means. The mapping
     * happens here, before any filter, column or chip, so no view has to remember that a
     * `proposed` row is an `open` one - and nothing writes the file back.
     */
    function normalizeBoard(board) {
      if (board === null || typeof board !== 'object' || !Array.isArray(board.tasks)) return { version: 1, revision: 0, tasks: [] }
      return {
        ...board,
        tasks: board.tasks.map((task) => task !== null && typeof task === 'object' && task.status !== undefined ? { ...task, status: mapStatus(task.status) } : task),
      }
    }

    async function readBoard(remote, sessionId, signal) {
      if (typeof sessionId !== 'string' || sessionId === '') return { board: null }
      let offset = 1
      let text = ''
      let complete = false
      // A maximal board is about 75 pages; 200 leaves room and never parses a truncated ledger.
      for (let page = 0; page < 200; page += 1) {
        const result = await remote.workspaceFiles.read(sessionId, FILE, { offset, limit: 2000 }, signal)
        if (!result.ok) {
          if (isMissing(result.error)) return { board: null }
          return { error: result.error.message ?? result.error.code ?? 'read failed' }
        }
        if (result.value === null || result.value === undefined) return { error: 'read returned no value' }
        text += result.value.text
        if (result.value.eof) {
          complete = true
          break
        }
        if (result.value.lines === 0) return { error: 'ledger is too large to read: the read did not reach EOF within 200 pages.' }
        offset = result.value.offset + result.value.lines
        text += '\n'
      }
      if (!complete) return { error: 'ledger is too large to read: the ledger did not reach EOF within 200 pages.' }
      if (text.trim() === '') return { board: null }
      try {
        const board = JSON.parse(text)
        return { board: normalizeBoard(board) }
      } catch (error) {
        return { error: `ledger is not valid JSON: ${error.message}` }
      }
    }

    async function runOp(remote, sessionId, op) {
      if (remote === null || remote === undefined || remote.commands === undefined || typeof remote.commands.execute !== 'function') {
        return { ok: false, error: 'The taskboard command is unavailable in this view.' }
      }
      const result = await remote.commands.execute(sessionId, `/taskboard ${JSON.stringify(op)}`, [])
      if (result === null || result === undefined) return { ok: false, error: 'The taskboard command returned no result.' }
      if (!result.ok) return { ok: false, error: result.error?.message ?? result.error?.code ?? 'command failed' }
      if (result.value === null || result.value === undefined) return { ok: false, error: 'The taskboard command returned no result.' }
      const outcome = result.value.result
      if (outcome === null || outcome === undefined) return { ok: false, error: 'The taskboard command returned no result.' }
      if (outcome.kind === 'error') return { ok: false, error: outcome.text ?? 'command failed' }
      if (outcome.kind !== 'success') return { ok: false, error: `The taskboard command returned an unexpected result (${String(outcome.kind ?? 'none')}).` }
      return { ok: true, text: outcome.text ?? '' }
    }

    /** The status a row MEANS; the file keeps whatever it stores. */
    function mapStatus(value) {
      if (Object.prototype.hasOwnProperty.call(LEGACY_STATUS, value)) return LEGACY_STATUS[value]
      return STATUSES.includes(value) ? value : 'open'
    }

    function statusTone(status) {
      if (status === 'done') return 'ok'
      if (status === 'active' || status === 'review' || status === 'paused') return 'warn'
      if (status === 'blocked') return 'bad'
      return ''
    }

    /** A task's specialty: a role with its preset, or inline work the owner does itself. */
    function assignmentOf(task) {
      const role = typeof task?.role === 'string' && task.role.trim() !== '' ? task.role.trim() : ''
      if (role !== '') return { role, preset: typeof task?.preset === 'string' && task.preset !== '' ? task.preset : null, inline: false }
      return { role: null, preset: null, inline: task?.inline === true }
    }

    const CHILD_STATES = ['active', 'sleeping', 'paused']

    function sessionIdsOf(workspace) {
      if (workspace === null || workspace === undefined || !Array.isArray(workspace.sessionIds)) return []
      return workspace.sessionIds.filter((id) => typeof id === 'string' && id !== '')
    }

    function isLiveSession(sessionsById, sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return false
      return ((sessionsById?.[sessionId]?.retainedBy?.mainView ?? 0) > 0)
    }

    function pickWorkspaceSession(workspace, sessionsById, preferredId) {
      const ids = sessionIdsOf(workspace)
      if (ids.length === 0) return null
      if (typeof preferredId === 'string' && ids.includes(preferredId) && isLiveSession(sessionsById, preferredId)) return preferredId
      const live = ids.find((id) => isLiveSession(sessionsById, id))
      if (live !== undefined) return live
      if (typeof preferredId === 'string' && ids.includes(preferredId)) return preferredId
      return ids[0]
    }

    /**
     * One child row per linked session. The Host's `children[]` is authoritative;
     * older tasks that only have `childSessionIds[]` fall back to id + "child".
     */
    function normalizeChildren(task) {
      const rows = []
      const seen = new Set()
      const timeline = Array.isArray(task?.timeline) ? task.timeline : []
      const owner = task?.owner !== null && typeof task?.owner === 'object' ? task.owner : null
      const fallbackStatus = task?.status === 'active' ? 'active' : task?.status === 'paused' ? 'paused' : ['review', 'done', 'cancelled'].includes(task?.status) ? 'sleeping' : 'linked'
      const fallback = (sessionId) => {
        const started = timeline.find((entry) => entry?.kind === 'child_started' && entry?.sessionId === sessionId)
        const match = typeof started?.text === 'string' ? /^Delegated to (.+)$/.exec(started.text) : null
        const label = owner?.sessionId === sessionId && typeof owner.label === 'string' ? owner.label : match?.[1] ?? ''
        return { label, role: label, status: fallbackStatus }
      }
      const add = (sessionId, label, role, status) => {
        if (typeof sessionId !== 'string' || sessionId === '' || seen.has(sessionId)) return
        seen.add(sessionId)
        const derived = fallback(sessionId)
        const resolvedRole = typeof role === 'string' && role !== '' && role !== 'child' ? role : (derived.role || task?.title || 'child')
        const resolvedLabel = typeof label === 'string' && label !== '' ? label : derived.label
        const resolvedStatus = CHILD_STATES.includes(status) && status !== 'linked' ? status : derived.status
        rows.push({
          sessionId,
          label: resolvedLabel !== '' ? resolvedLabel : sessionId,
          role: resolvedRole !== '' ? resolvedRole : 'child',
          status: resolvedStatus,
        })
      }
      if (Array.isArray(task?.children)) {
        for (const child of task.children) {
          if (child !== null && typeof child === 'object') add(child.sessionId, child.label, child.role, child.status)
        }
      }
      if (Array.isArray(task?.childSessionIds)) {
        for (const sessionId of task.childSessionIds) add(sessionId, '', 'child', 'linked')
      }
      return rows
    }

    /** A role row the ledger can prove is not a running specialist any more. */
    function isGhost(row) {
      return row?.orphan === true || row?.stale === true
    }

    function childCounts(rows) {
      return {
        total: rows.length,
        active: rows.filter((row) => row.status === 'active' && !isGhost(row)).length,
        sleeping: rows.filter((row) => row.status === 'sleeping' && !isGhost(row)).length,
        paused: rows.filter((row) => row.status === 'paused' && !isGhost(row)).length,
        linked: rows.filter((row) => row.status === 'linked' && !isGhost(row)).length,
        stale: rows.filter(isGhost).length,
      }
    }

    function subagentWord(count) {
      return count === 1 ? 'subagent' : 'subagents'
    }

    function subagentSummary(rows) {
      const counts = childCounts(rows)
      const parts = [`${counts.total} ${subagentWord(counts.total)}`, `${counts.active} active`, `${counts.sleeping} sleeping`]
      if (counts.paused > 0) parts.push(`${counts.paused} paused`)
      if (counts.linked > 0) parts.push(`${counts.linked} linked`)
      if (counts.stale > 0) parts.push(`${counts.stale} stale`)
      return parts.join(' · ')
    }

    /** The former Subagents column, folded into Role: how many children and how many run. */
    function childColumnSummary(rows) {
      if (rows.length === 0) return ''
      const counts = childCounts(rows)
      const parts = [`${rows.length} ${rows.length === 1 ? 'child' : 'children'}`]
      if (counts.active > 0) parts.push(`${counts.active} active`)
      if (counts.paused > 0) parts.push(`${counts.paused} paused`)
      if (counts.stale > 0) parts.push(`${counts.stale} stale`)
      return parts.join(' · ')
    }

    /** The role cell every view shares: the chip, its preset id, and the child count. */
    function RoleCell({ task, presets }) {
      const assignment = assignmentOf(task)
      if (assignment.role === null && !assignment.inline) {
        return h('span', { className: 'tb-chip missing', title: 'No role and no inline flag: a row from before the role rule. Edit it to assign one.' }, 'unassigned')
      }
      if (assignment.inline) {
        return h('span', { className: 'tb-chip inline', title: 'Inline: the task owner does this work itself, with no specialist child' }, 'inline')
      }
      const preset = assignment.preset ?? presets?.[assignment.role] ?? null
      return h(React.Fragment, null,
        h('span', { className: 'tb-chip role' }, assignment.role),
        preset === null ? null : h('span', { className: 'tb-preset', title: `Preset ${preset}` }, preset),
      )
    }

    /**
     * The role rows that belong to the tasks in view.
     *
     * A workspace's `agents[]` is history: a role delegated in an earlier chat stays there
     * after the chat ends, so counting the whole array above a chat board reports
     * specialists nobody in this chat can reach. A row belongs to the view when it was
     * opened for one of the visible tasks (its session is a child or the owner) or when it
     * records this chat in `chatSessionId`. The All-chats read asks for the workspace view
     * and gets every row, with its own label.
     */
    function agentRowsFor(tasks, agents, chatId, all) {
      const rows = Array.isArray(agents) ? agents : []
      if (all) return rows
      const linked = new Set()
      for (const task of Array.isArray(tasks) ? tasks : []) {
        for (const child of normalizeChildren(task)) linked.add(child.sessionId)
        for (const id of Array.isArray(task?.childSessionIds) ? task.childSessionIds : []) if (typeof id === 'string') linked.add(id)
        if (typeof task?.owner?.sessionId === 'string' && task.owner.sessionId !== '') linked.add(task.owner.sessionId)
      }
      return rows.filter((agent) => linked.has(agent.sessionId) || (chatId !== '' && agent.chatSessionId === chatId))
    }

    function subagentRoster(tasks, agents = []) {
      const seen = new Map()
      for (const agent of Array.isArray(agents) ? agents : []) {
        if (typeof agent?.sessionId !== 'string' || agent.sessionId === '') continue
        seen.set(agent.sessionId, {
          sessionId: agent.sessionId,
          label: typeof agent.label === 'string' && agent.label !== '' ? agent.label : agent.sessionId,
          role: typeof agent.role === 'string' && agent.role !== '' ? agent.role : 'specialist',
          status: CHILD_STATES.includes(agent.status) ? agent.status : 'linked',
          ...(agent.orphan === true ? { orphan: true } : {}),
          ...(agent.stale === true ? { stale: true } : {}),
        })
      }
      for (const task of tasks) {
        for (const row of normalizeChildren(task)) {
          if (!seen.has(row.sessionId)) seen.set(row.sessionId, row)
        }
      }
      return Array.from(seen.values())
    }

    function roleCounts(rows) {
      const counts = new Map()
      for (const row of rows) counts.set(row.role, (counts.get(row.role) ?? 0) + 1)
      return Array.from(counts, ([role, count]) => ({ role, count }))
    }

    function parseResultPayload(text) {
      if (typeof text !== 'string' || text.trim() === '') return null
      try {
        const parsed = JSON.parse(text)
        return parsed !== null && typeof parsed === 'object' ? parsed : null
      } catch {
        // A result that is not JSON means the next poll is the source of truth.
        return null
      }
    }

    function taskOfPayload(payload) {
      if (payload === null || payload === undefined || typeof payload !== 'object') return null
      if (payload.task !== null && payload.task !== undefined && typeof payload.task === 'object') return payload.task
      if (typeof payload.id === 'string') return payload
      return null
    }

    function resultMessages(payload) {
      const messages = []
      if (payload === null || typeof payload !== 'object') return messages
      for (const key of ['errors', 'warnings']) {
        const value = payload[key]
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (typeof entry === 'string' && entry.trim() !== '') messages.push(entry.trim())
            else if (entry !== null && typeof entry === 'object' && typeof entry.message === 'string' && entry.message.trim() !== '') messages.push(entry.message.trim())
          }
        } else if (typeof value === 'string' && value.trim() !== '') {
          messages.push(value.trim())
        }
      }
      for (const key of ['error', 'warning']) {
        if (typeof payload[key] === 'string' && payload[key].trim() !== '') messages.push(payload[key].trim())
      }
      return messages
    }

    /** Keep acceptance `{text, done}` flags when the text itself is unchanged. */
    function mergeAcceptance(existing, texts) {
      const previous = new Map()
      for (const entry of Array.isArray(existing) ? existing : []) {
        const text = typeof entry === 'string' ? entry : entry?.text
        if (typeof text !== 'string' || text === '') continue
        const done = entry !== null && typeof entry === 'object' && entry.done === true
        if (!previous.has(text)) previous.set(text, [])
        previous.get(text).push(done)
      }
      return texts.map((text) => {
        const queue = previous.get(text)
        return { text, done: Array.isArray(queue) && queue.length > 0 ? queue.shift() === true : false }
      })
    }

    function shortTime(value) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return ''
      const minutes = Math.round((Date.now() - date.getTime()) / 60000)
      if (minutes < 1) return 'now'
      if (minutes < 60) return `${minutes}m`
      if (minutes < 1440) return `${Math.round(minutes / 60)}h`
      return `${Math.round(minutes / 1440)}d`
    }

    function Icon({ size = 18, active = false }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M7 9.5h4M7 13h7M7 16.5h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M15.5 15.5l1.6 1.6 3-3.2', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function TasksTrigger({ remote, store, layout, sessionId, useSessions }) {
      const [count, setCount] = useState(0)
      const sessionsRaw = useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && sessionsRaw !== undefined && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      // The header trigger runs on a child conversation too. A task's chatId is the ROOT of the
      // lineage, so comparing it with the raw session id counted 0 here while the pane showed
      // the board. Same resolver as the pane (chatIdOf), so the badge and the board agree.
      const chatId = chatIdOf(sessionId, sessionsById)
      useEffect(() => {
        let cancelled = false
        const controller = new AbortController()
        const tick = async () => {
          const result = await readBoard(remote, sessionId, controller.signal)
          // This chat's board only: a new chat is a new board, and a count of the whole
          // workspace on a fresh conversation reads as tasks this chat cannot see.
          if (!cancelled && result.board) setCount(result.board.tasks.filter((task) => chatOf(task) === chatId).length)
        }
        tick().catch(() => {})
        const timer = setInterval(() => { tick().catch(() => {}) }, 5000)
        return () => { cancelled = true; controller.abort(); clearInterval(timer) }
      }, [remote, sessionId, chatId])
      const open = () => {
        store.set({ sessionId, returnSessionId: sessionId })
        layout.selectPanel(PANEL_ID)
      }
      return h(React.Fragment, null,
        h('style', null, CSS),
        h('button', { type: 'button', className: 'tb-trigger', onClick: open, title: 'Open the task board', 'aria-label': `Open tasks${count > 0 ? `, ${count} total` : ''}` },
          h(Icon, { size: 14 }),
          h('span', { className: 'tb-trigger-label' }, 'Tasks '),
          count > 0 ? h('span', { className: 'n' }, String(count)) : null,
        ),
      )
    }

    function PanelIcon({ size = 18, active = false, layout, store, useSessions }) {
      const sessionsRaw = useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && sessionsRaw !== undefined && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      const main = Object.values(sessionsById).find((session) => (session?.retainedBy?.mainView ?? 0) > 0)
      const open = () => {
        const next = typeof main?.id === 'string' && main.id !== '' ? main.id : null
        store.set({ ...(next === null ? {} : { sessionId: next }), returnSessionId: next })
        layout.selectPanel(PANEL_ID)
      }
      return h(React.Fragment, null,
        h('style', null, CSS),
        h('button', { type: 'button', className: `tb-icon${active ? ' active' : ''}`, onClick: open, title: 'Tasks', 'aria-label': 'Open the task board', style: { width: size + 12, height: size + 12 } },
          h(Icon, { size, active }),
        ),
      )
    }

    function TaskCard({ task, selected, onSelect, chatId, presets }) {
      const children = normalizeChildren(task)
      const assignment = assignmentOf(task)
      const scope = Array.isArray(task.scope) ? task.scope : []
      const ownerChat = chatOf(task)
      const foreign = ownerChat !== null && chatId !== '' && ownerChat !== chatId
      const ownerWord = assignment.inline ? 'inline' : (task.owner?.label ?? 'unowned')
      return h('div', {
        className: `tb-card${selected ? ' sel' : ''}`,
        role: 'button',
        tabIndex: 0,
        onClick: () => onSelect(task.id),
        onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(task.id) } },
        'aria-pressed': selected,
        title: foreign ? `Created in another chat (${ownerChat})` : task.objective,
      },
        h('div', { className: 't' }, task.title),
        task.objective ? h('div', { className: 's' }, task.objective.length > 90 ? `${task.objective.slice(0, 90)}…` : task.objective) : null,
        h('div', { className: 'tb-chips' },
          h('span', { className: `tb-chip ${statusTone(task.status)}` }, task.status),
          h(RoleCell, { task, presets }),
          foreign ? h('span', { className: 'tb-chip' }, 'other chat') : null,
          children.length > 0 ? h('span', { className: 'tb-chip sub' }, childColumnSummary(children)) : null,
          scope.slice(0, 2).map((entry, index) => h('span', { className: 'tb-chip', key: `s${index}` }, entry)),
          scope.length > 2 ? h('span', { className: 'tb-chip' }, `+${scope.length - 2}`) : null,
        ),
        h('div', { className: 'f' },
          h('span', { className: 'tb-avatar' }, ownerWord.slice(0, 1).toUpperCase()),
          h('span', { className: 'o' }, ownerWord),
          h('span', { style: { marginLeft: 'auto' } }, shortTime(task.updatedAt)),
        ),
      )
    }

    function TaskDetail({ task, busy, error, canEdit, presets, onHide, onSave, onNote, onOpenSession, onAction, onRefresh }) {
      const [draft, setDraft] = useState(() => draftOf(task))
      const baseRef = useRef(task)
      const [conflict, setConflict] = useState(false)
      useEffect(() => {
        const base = baseRef.current
        if (task.id !== base.id) {
          baseRef.current = task
          setDraft(draftOf(task))
          setConflict(false)
          return
        }
        if (task.revision === base.revision) return
        // Our own successful save echoes the draft back; accept it as the new base.
        const draftJson = draftKey(draft)
        if (draftJson !== taskKey(base)) {
          if (draftJson === taskKey(task)) {
            baseRef.current = task
            setDraft(draftOf(task))
            setConflict(false)
            return
          }
          // A background poll must not discard a dirty draft; offer Refresh instead.
          setConflict(true)
          return
        }
        baseRef.current = task
        setDraft(draftOf(task))
        setConflict(false)
      }, [task.id, task.revision])
      const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
      const refreshDraft = () => {
        baseRef.current = task
        setDraft(draftOf(task))
        setConflict(false)
        if (typeof onRefresh === 'function') onRefresh()
      }
      const save = () => {
        const title = draft.title.trim()
        if (title === '' || !canEdit) return
        const base = baseRef.current
        const patch = {
          title,
          objective: draft.objective,
          scope: lines(draft.scope),
          nonScope: lines(draft.nonScope),
          acceptance: mergeAcceptance(base.acceptance, lines(draft.acceptance)),
          result: {
            ...(base.result !== null && typeof base.result === 'object' ? base.result : {}),
            summary: draft.resultSummary,
            evidence: lines(draft.resultEvidence),
          },
        }
        // The host requires a reason to hold a task in blocked; only send it when it moved.
        if (draft.reason.trim() !== String(base.reason ?? '').trim()) patch.reason = draft.reason.trim()
        // The assignment. One rule: a specialist role (with an owner) or inline work; the host
        // refuses an open->active move that has neither, and refuses both at once here.
        const role = draft.role.trim()
        if (role !== (base.role ?? '')) patch.role = role
        if (draft.inline === true && role !== '') patch.inline = false
        else if (draft.inline !== (base.inline === true)) patch.inline = draft.inline === true
        const ownerLabel = draft.ownerLabel.trim()
        if (ownerLabel !== (base.owner?.label ?? '')) patch.owner = ownerLabel === '' ? null : { kind: 'agent', label: ownerLabel, ...(base.owner?.sessionId === undefined ? {} : { sessionId: base.owner.sessionId }) }
        // Paused and done are lifecycle actions, not ordinary field edits.
        if (draft.status !== base.status && draft.status !== 'paused' && draft.status !== 'done') patch.status = draft.status
        onSave(task.id, base.revision, patch)
      }
      const timeline = Array.isArray(task.timeline) ? task.timeline.slice().reverse() : []
      const children = normalizeChildren(task)
      const artifacts = Array.isArray(task.result?.artifacts) ? task.result.artifacts : []
      const closed = task.status === 'done' || task.status === 'cancelled'
      const paused = task.status === 'paused'
      const titleEmpty = draft.title.trim() === ''
      const dirty = draftKey(draft) !== taskKey(baseRef.current)
      const hintId = `tb-save-hint-${task.id}`
      const saveLabel = busy ? 'Saving…' : !canEdit ? 'Save changes' : titleEmpty ? 'Title required' : dirty ? 'Save changes' : 'Saved'
      const hint = !canEdit
        ? 'Read-only — open a live conversation to edit this board.'
        : titleEmpty
          ? 'A task needs a non-empty title. Add one before saving.'
          : conflict
            ? `This task changed in the ledger (now rev ${task.revision}). Your draft is kept; Refresh loads the latest revision.`
            : busy
              ? 'Writing the task ledger…'
              : dirty
                ? 'Unsaved changes — Save writes the title, status and every field below to the workspace ledger.'
                : 'All fields are saved in the workspace ledger. Pause, Close and Remove act immediately.'
      return h('div', null,
        h('div', { className: 'tb-detail-head' },
          h('div', { className: 'tb-kicker' }, `Task ${task.id} · rev ${task.revision}`),
          h('button', { type: 'button', className: 'tb-btn tb-hide', onClick: onHide, title: 'Hide the task detail pane', 'aria-controls': 'tb-detail-pane' }, 'Hide'),
        ),
        h('h2', null, task.title),
        h('div', { className: 'tb-sec' },
          h('div', { className: 'tb-row', style: { marginBottom: 4 } },
            h('span', { className: 'tb-label', style: { margin: 0 } }, 'Role'),
            h(RoleCell, { task, presets }),
            task.inline === true ? h('span', { className: 'tb-chip', title: 'Nobody was delegated this task' }, 'no child') : null,
            task.reason ? h('span', { className: 'tb-chip bad' }, `blocked: ${task.reason}`) : null,
          ),
          // THE ASSIGNMENT IS EDITABLE: a pre-role row can only reach active once it has a
          // role with an owner (or is inline), and before this editor existed the human had
          // no way to say which it is.
          h('div', { className: 'tb-row' },
            h('label', { className: 'tb-label', htmlFor: `tb-role-${task.id}`, style: { margin: 0 } }, 'Assign role'),
            // Typing a role clears the inline flag on save (a task is one or the other), so the
            // field stays editable instead of asking the human to uncheck a box first.
            h('input', { id: `tb-role-${task.id}`, className: 'tb-input', style: { maxWidth: 180 }, value: draft.role, onChange: (event) => set('role', event.target.value), readOnly: !canEdit, placeholder: 'BACKEND' }),
            h('label', { className: 'tb-label', htmlFor: `tb-owner-${task.id}`, style: { margin: 0 } }, 'Owner'),
            h('input', { id: `tb-owner-${task.id}`, className: 'tb-input', style: { maxWidth: 180 }, value: draft.ownerLabel, onChange: (event) => set('ownerLabel', event.target.value), readOnly: !canEdit, placeholder: 'the child or the human' }),
            h('label', { className: 'tb-row', style: { margin: 0, gap: 4 } },
              h('input', { type: 'checkbox', checked: draft.inline, onChange: (event) => set('inline', event.target.checked), disabled: !canEdit }),
              h('span', { className: 'tb-label', style: { margin: 0 } }, 'Inline — I do this myself'),
            ),
          ),
          h('div', { className: 'tb-policy' },
            h('b', null, 'One rule: '),
            'a task belongs to a specialist role (its preset is the child tool set) or it is ',
            h('b', null, 'inline'),
            ' — the owner does the work itself. Moving a task from open to active needs one of those; ',
            h('b', null, 'review'),
            ' needs a result summary and evidence, ',
            h('b', null, 'blocked'),
            ' needs a reason, and done is reached only by Close from review.',
          ),
        ),
        h('div', { className: 'tb-row' },
          h('select', { className: 'tb-select', value: draft.status, onChange: (event) => set('status', event.target.value), 'aria-label': 'Task status', 'aria-describedby': hintId, title: 'Paused and done change through Pause/Resume and Close, not Save', disabled: busy || !canEdit },
            STATUSES.map((status) => h('option', { value: status, key: status, disabled: status === 'paused' || status === 'done' }, status)),
          ),
          h('span', { className: `tb-chip ${statusTone(task.status)}` }, task.status),
          h('button', { type: 'button', className: 'tb-btn primary', onClick: save, disabled: busy || !dirty || !canEdit || titleEmpty, title: !canEdit ? 'Open a live conversation to edit this board' : titleEmpty ? 'A task needs a non-empty title' : dirty ? 'Save every edited field to the task ledger' : 'No unsaved edits', 'aria-describedby': hintId }, saveLabel),
        ),
        h('div', { className: 'tb-savehint', id: hintId, 'aria-live': 'polite' }, hint),
        conflict ? h('div', { className: 'tb-conflict', role: 'status', 'aria-live': 'polite' },
          h('span', null, `The ledger now has rev ${task.revision}. Your draft was not replaced.`),
          h('button', { type: 'button', className: 'tb-btn', onClick: refreshDraft, title: 'Load the latest task revision into the form' }, 'Refresh'),
        ) : null,
        h('div', { className: 'tb-row' },
          h('button', { type: 'button', className: 'tb-btn', onClick: () => onAction(paused ? 'resume' : 'pause', task.id), disabled: busy || closed || !canEdit, title: paused ? 'Continue tracking this task; linked children are not re-prompted' : 'Hold this task and interrupt its linked children' }, paused ? 'Resume' : 'Pause'),
          h('button', { type: 'button', className: 'tb-btn', onClick: () => onAction('cancel', task.id), disabled: busy || closed || !canEdit, title: 'Abandon this task and interrupt its linked children. The one door for a paused task or one that still has children' }, 'Cancel'),
          h('button', { type: 'button', className: 'tb-btn', onClick: () => onAction('close', task.id), disabled: busy || closed || !canEdit || task.status !== 'review', title: task.status === 'review' ? 'Accept this task as done' : 'Only a task in review can be accepted; moving work to review needs a result and evidence' }, 'Close'),
          h('button', { type: 'button', className: 'tb-btn danger', onClick: () => onAction('remove', task.id), disabled: busy || !canEdit }, 'Remove'),
        ),
        error ? h('div', { className: 'tb-banner' }, error) : null,
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-title-${task.id}` }, 'Title'),
          h('input', { id: `tb-title-${task.id}`, className: 'tb-input', value: draft.title, onChange: (event) => set('title', event.target.value), readOnly: !canEdit, 'aria-invalid': titleEmpty ? 'true' : undefined, 'aria-describedby': hintId }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-obj-${task.id}` }, 'Objective'),
          h('textarea', { id: `tb-obj-${task.id}`, className: 'tb-area', value: draft.objective, onChange: (event) => set('objective', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-scope-${task.id}` }, 'Scope — one per line'),
          h('textarea', { id: `tb-scope-${task.id}`, className: 'tb-area small', value: draft.scope, onChange: (event) => set('scope', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-non-${task.id}` }, 'Non-scope — one per line'),
          h('textarea', { id: `tb-non-${task.id}`, className: 'tb-area small', value: draft.nonScope, onChange: (event) => set('nonScope', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-acc-${task.id}` }, 'Acceptance — one per line'),
          h('textarea', { id: `tb-acc-${task.id}`, className: 'tb-area small', value: draft.acceptance, onChange: (event) => set('acceptance', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-res-${task.id}` }, 'Result summary'),
          h('textarea', { id: `tb-res-${task.id}`, className: 'tb-area', value: draft.resultSummary, onChange: (event) => set('resultSummary', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-evi-${task.id}` }, 'Evidence — one per line'),
          h('textarea', { id: `tb-evi-${task.id}`, className: 'tb-area small', value: draft.resultEvidence, onChange: (event) => set('resultEvidence', event.target.value), readOnly: !canEdit }),
        ),
        h('div', { className: 'tb-sec' },
          h('label', { className: 'tb-label', htmlFor: `tb-reason-${task.id}` }, 'Reason — required when blocked'),
          h('input', { id: `tb-reason-${task.id}`, className: 'tb-input', value: draft.reason, onChange: (event) => set('reason', event.target.value), readOnly: !canEdit, placeholder: 'What the task is waiting on' }),
        ),
        h('div', { className: 'tb-sec' },
          h('h4', null, 'Timeline'),
          timeline.length === 0 ? h('p', null, 'No events yet.') : h('ul', { className: 'tb-timeline' },
            timeline.map((entry, index) => h('li', { className: `tb-ev ${entry.kind === 'child_finished' ? 'ok' : entry.kind === 'edited' ? '' : entry.kind === 'blocked' ? 'bad' : ''}`, key: `${entry.at}-${index}` },
              h('span', { className: 'b' }),
              h('div', { className: 'who' }, entry.actor ?? 'system'),
              h('div', { className: 'what' }, entry.text ?? entry.kind),
              h('div', { className: 'when' }, shortTime(entry.at)),
            )),
          ),
        ),
        h('div', { className: 'tb-sec' },
          h('h4', null, 'Add a note'),
          h('div', { className: 'tb-note' },
            h('input', { className: 'tb-input', placeholder: 'A decision, a blocker, an evidence link…', readOnly: !canEdit, onKeyDown: (event) => { if (event.key === 'Enter' && event.currentTarget.value.trim() !== '') { onNote(task.id, event.currentTarget.value.trim()); event.currentTarget.value = '' } } }),
            h('button', { type: 'button', className: 'tb-btn', onClick: (event) => { const input = event.currentTarget.previousSibling; if (input.value.trim() !== '') { onNote(task.id, input.value.trim()); input.value = '' } }, disabled: busy || !canEdit }, 'Add'),
          ),
        ),
        children.length > 0 ? h('div', { className: 'tb-sec' },
          h('h4', null, 'Subagents'),
          h('div', { className: 'tb-subsummary' }, subagentSummary(children)),
          h('ul', { className: 'tb-subs' },
            children.map((child) => h('li', { className: 'tb-sub', key: child.sessionId },
              h('span', { className: 'role' }, child.role),
              h('span', { className: 'who' },
                h('span', { className: 'label', title: child.label }, child.label),
                child.label !== child.sessionId ? h('span', { className: 'id', title: child.sessionId }, child.sessionId) : null,
              ),
              h('span', { className: `state ${child.status}${isGhost(child) ? ' stale' : ''}`, title: child.orphan === true ? 'Its task is gone; nothing is running behind this role' : child.stale === true ? 'Untouched for more than a day; the chat that owned it is gone' : undefined }, child.orphan === true ? 'orphan' : child.stale === true ? 'stale' : child.status),
              h('button', { type: 'button', className: 'tb-btn', onClick: () => onOpenSession(child.sessionId), title: `Open subagent ${child.label}`, 'aria-label': `Open ${child.role} ${child.label}` }, 'Open'),
            )),
          ),
        ) : null,
        artifacts.length > 0 ? h('div', { className: 'tb-sec' },
          h('h4', null, 'Artifacts'),
          h('div', { className: 'tb-children' }, artifacts.map((artifact) => h('div', { className: 'tb-child', key: artifact }, h('span', { className: 'id' }, artifact)))),
        ) : null,
      )
    }

    function lines(value) {
      return String(value ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '')
    }

    function draftKey(draft) {
      return JSON.stringify({
        // The Host trims these two; compare the normalized values so our own
        // save echo is not mistaken for an external edit.
        title: String(draft.title ?? '').trim(),
        status: draft.status,
        reason: String(draft.reason ?? '').trim(),
        role: String(draft.role ?? '').trim(),
        inline: draft.inline === true,
        ownerLabel: String(draft.ownerLabel ?? '').trim(),
        objective: draft.objective,
        scope: lines(draft.scope),
        nonScope: lines(draft.nonScope),
        acceptance: lines(draft.acceptance),
        result: { summary: String(draft.resultSummary ?? '').trim(), evidence: lines(draft.resultEvidence) },
      })
    }

    function taskKey(task) {
      return JSON.stringify({
        title: task.title ?? '',
        status: task.status ?? '',
        reason: task.reason ?? '',
        role: task.role ?? '',
        inline: task.inline === true,
        ownerLabel: task.owner?.label ?? '',
        objective: task.objective ?? '',
        scope: Array.isArray(task.scope) ? task.scope : [],
        nonScope: Array.isArray(task.nonScope) ? task.nonScope : [],
        acceptance: Array.isArray(task.acceptance) ? task.acceptance.map((entry) => (typeof entry === 'string' ? entry : entry.text)) : [],
        result: { summary: task.result?.summary ?? '', evidence: Array.isArray(task.result?.evidence) ? task.result.evidence : [] },
      })
    }

    function draftOf(task) {
      return {
        title: task.title ?? '',
        status: task.status ?? 'open',
        reason: task.reason ?? '',
        // The assignment the human edits: a specialist role, or inline work, and who owns it.
        role: task.role ?? '',
        inline: task.inline === true,
        ownerLabel: task.owner?.label ?? '',
        objective: task.objective ?? '',
        scope: Array.isArray(task.scope) ? task.scope.join('\n') : '',
        nonScope: Array.isArray(task.nonScope) ? task.nonScope.join('\n') : '',
        acceptance: Array.isArray(task.acceptance) ? task.acceptance.map((entry) => (typeof entry === 'string' ? entry : entry.text)).join('\n') : '',
        resultSummary: task.result?.summary ?? '',
        resultEvidence: Array.isArray(task.result?.evidence) ? task.result.evidence.join('\n') : '',
      }
    }

    function TaskList({ tasks, selectedId, onSelect, chatId, presets }) {
      if (tasks.length === 0) return h('div', { className: 'tb-listwrap', role: 'region', 'aria-label': 'Task list' }, h('div', { className: 'tb-empty' }, 'No tasks match this filter.'))
      return h('div', { className: 'tb-listwrap', role: 'region', 'aria-label': 'Task list' },
        h('div', { className: 'tb-listhead', 'aria-hidden': true },
          h('span', null, 'Status'),
          h('span', null, 'Role'),
          h('span', null, 'Task'),
          h('span', null, 'Owner'),
          h('span', null, 'Updated'),
        ),
        h('div', { className: 'tb-list', role: 'list' },
          tasks.map((task) => {
            const children = normalizeChildren(task)
            const assignment = assignmentOf(task)
            const selected = task.id === selectedId
            // In the All-chats read, say which rows are not this chat's: an old task's
            // owner and child sessions read as current work otherwise.
            const ownerChat = chatOf(task)
            const foreign = ownerChat !== null && chatId !== '' && ownerChat !== chatId
            const roleWord = assignment.role ?? (assignment.inline ? 'inline' : 'unassigned')
            const ownerWord = assignment.inline ? 'inline' : (task.owner?.label ?? 'unowned')
            return h('div', { className: 'tb-listitem', role: 'listitem', key: task.id },
              h('button', {
                type: 'button',
                className: `tb-listrow${selected ? ' sel' : ''}`,
                onClick: () => onSelect(task.id),
                'aria-pressed': selected,
                'aria-label': `${task.title}, ${task.status}, ${roleWord}${children.length > 0 ? `, ${childColumnSummary(children)}` : ''}, owner ${ownerWord}${foreign ? ', created in another chat' : ''}`,
                title: foreign ? `Created in another chat (${ownerChat})` : (task.objective || task.title),
              },
                h('span', { className: `tb-chip ${statusTone(task.status)}` }, task.status),
                h('span', { className: 'tb-listrole' },
                  h(RoleCell, { task, presets }),
                  foreign ? h('span', { className: 'tb-chip', title: `Created in another chat (${ownerChat})` }, 'other chat') : null,
                  children.length > 0 ? h('span', { className: 'tb-kids' }, childColumnSummary(children)) : null,
                ),
                h('span', { className: 'tb-listtitle' },
                  h('span', { className: 't' }, task.title),
                  task.objective ? h('span', { className: 's' }, task.objective) : null,
                ),
                h('span', { className: 'tb-listowner' }, ownerWord),
                h('span', { className: 'tb-listtime' }, shortTime(task.updatedAt)),
              ),
            )
          }),
        ),
      )
    }

    function TasksPage({ remote, store, uiWorkspace, useWorkspaces, useSessions }) {
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const workspacesRaw = useWorkspaces((snapshot) => snapshot.items)
      const workspaces = Array.isArray(workspacesRaw) ? workspacesRaw : []
      const sessionsRaw = useSessions((snapshot) => snapshot.byId)
      const sessionsById = sessionsRaw !== null && sessionsRaw !== undefined && typeof sessionsRaw === 'object' ? sessionsRaw : {}
      const [board, setBoard] = useState(null)
      const [selectedId, setSelectedId] = useState(null)
      const [readError, setReadError] = useState('')
      const [writeError, setWriteError] = useState('')
      const [busy, setBusy] = useState(false)
      const [detailOpen, setDetailOpen] = useState(true)
      const [view, setView] = useState(null)
      const [query, setQuery] = useState('')
      const [statusFilter, setStatusFilter] = useState('all')
      // The board is per chat. All chats is a read of the workspace history, not a store.
      const [scope, setScope] = useState('chat')
      const controllerRef = useRef(null)
      const boardRef = useRef(null)

      const sessionId = state.sessionId ?? firstSession(workspaces, sessionsById)?.sessionId ?? null
      const hasSession = typeof sessionId === 'string' && sessionId !== ''
      const canEdit = isLiveSession(sessionsById, sessionId)
      const error = writeError || readError

      useEffect(() => {
        const current = state.sessionId
        if (typeof current === 'string' && current !== '' && isLiveSession(sessionsById, current)) {
          const owner = workspaces.find((entry) => sessionIdsOf(entry).includes(current))
          if (owner !== undefined && state.workspaceTitle !== (owner.title ?? null)) store.set({ workspaceTitle: owner.title ?? null })
          return
        }
        const owner = typeof current === 'string' && current !== '' ? workspaces.find((entry) => sessionIdsOf(entry).includes(current)) : undefined
        const fallback = owner === undefined ? firstSession(workspaces, sessionsById) : null
        const workspace = owner ?? fallback?.workspace ?? null
        if (workspace === null) {
          if (current !== null && current !== undefined) store.set({ sessionId: null, workspaceTitle: null })
          return
        }
        const next = pickWorkspaceSession(workspace, sessionsById, current)
        if (next !== current || state.workspaceTitle !== (workspace.title ?? null)) {
          store.set({ sessionId: next, workspaceTitle: workspace.title ?? null })
        }
      }, [state.sessionId, state.workspaceTitle, workspaces, sessionsById, store])

      useEffect(() => {
        setBoard(null)
        setSelectedId(null)
        setReadError('')
        setWriteError('')
        // Opening a different chat means a different board; the workspace read is a
        // deliberate act each time, never a mode that silently follows you into a new chat.
        setScope('chat')
      }, [sessionId])

      const load = useCallback(async () => {
        if (!hasSession) return
        if (controllerRef.current) controllerRef.current.abort()
        const controller = new AbortController()
        controllerRef.current = controller
        let result
        try {
          result = await readBoard(remote, sessionId, controller.signal)
        } catch (failure) {
          if (!controller.signal.aborted) setReadError(failure?.message ?? 'read failed')
          return
        }
        if (controller.signal.aborted) return
        if (result.error) {
          // A read failure keeps the last good board and any write error.
          setReadError(result.error)
          return
        }
        setReadError('')
        setBoard(result.board ?? { version: 1, revision: 0, tasks: [] })
      }, [remote, sessionId, hasSession])

      useEffect(() => {
        load().catch((failure) => setReadError(failure?.message ?? 'read failed'))
        const timer = setInterval(() => { load().catch(() => {}) }, 2500)
        return () => { clearInterval(timer); if (controllerRef.current) controllerRef.current.abort() }
      }, [load])

      const tasks = Array.isArray(board?.tasks) ? board.tasks : []
      const chatId = chatIdOf(sessionId, sessionsById)
      // The ledger holds every chat; the panel's default view holds one. The All-chats
      // toggle is the read of the workspace history the agent gets from task_list scope
      // "workspace" - same data, same rule, so the human and the agent see one board.
      const chatTasks = scope === 'all' || chatId === '' ? tasks : tasks.filter((task) => chatOf(task) === chatId)
      const needle = query.trim().toLowerCase()
      const filteredTasks = chatTasks.filter((task) => {
        if (statusFilter !== 'all' && task.status !== statusFilter) return false
        if (needle === '') return true
        const children = normalizeChildren(task)
        const hay = [task.title, task.objective, ...(Array.isArray(task.scope) ? task.scope : []), ...(Array.isArray(task.nonScope) ? task.nonScope : []), task.owner?.label, task.role, ...children.flatMap((child) => [child.label, child.role])].filter((value) => typeof value === 'string').join(' ').toLowerCase()
        return hay.includes(needle)
      })
      const viewMode = view ?? (tasks.length > 8 ? 'list' : 'board')
      // The board unmounts when the List view is shown, so the listener must
      // be rebound whenever the view switches back to Board.
      useEffect(() => {
        const board = boardRef.current
        if (board === null) return undefined
        const onWheel = (event) => {
          if (event.defaultPrevented || event.ctrlKey || event.metaKey) return
          const rawX = event.deltaX
          const rawY = event.deltaY
          if (rawX === 0 && rawY === 0) return
          const max = board.scrollWidth - board.clientWidth
          if (max <= 0) return
          // One wheel gesture has one axis here. A vertical wheel and a horizontal
          // trackpad both drive the board sideways; the page must not also move.
          const dominant = Math.abs(rawX) > Math.abs(rawY) ? rawX : rawY
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientWidth : 1
          const delta = dominant * unit
          if (delta === 0) return
          event.preventDefault()
          const before = board.scrollLeft
          board.scrollLeft = Math.max(0, Math.min(max, before + delta))
        }
        board.addEventListener('wheel', onWheel, { passive: false })
        return () => board.removeEventListener('wheel', onWheel)
      }, [viewMode])

      const selected = tasks.find((task) => task.id === selectedId) ?? null
      useEffect(() => {
        if (selectedId === null && chatTasks.length > 0) {
          const active = chatTasks.find((task) => task.status === 'active' || task.status === 'review')
          setSelectedId((active ?? chatTasks[0]).id)
        }
      }, [chatTasks, selectedId])
      // A scope is a working set: a detail pane must not keep showing a task the visible
      // board says is not there. Switching scope drops a selection outside the new one.
      useEffect(() => {
        if (selectedId !== null && !chatTasks.some((task) => task.id === selectedId)) setSelectedId(null)
      }, [chatTasks, selectedId])

      const reload = () => {
        load().catch((failure) => setReadError(failure?.message ?? 'read failed'))
      }

      const run = async (op, options = {}) => {
        if (!hasSession || !canEdit) {
          const message = 'Open a live conversation to edit this board.'
          setWriteError(message)
          return { ok: false, error: message }
        }
        setBusy(true)
        try {
          let result
          try {
            // The write is attributed to the chat's root session, so a panel opened on a
            // child still creates and edits rows on the board the human is reading.
            result = await runOp(remote, chatId === '' ? sessionId : chatId, op)
          } catch (failure) {
            const message = failure?.message ?? 'The taskboard command failed.'
            setWriteError(message)
            return { ok: false, error: message }
          }
          if (!result.ok) {
            // Keep the current board and selection; a later poll must not hide this.
            setWriteError(result.error)
            return result
          }
          const payload = parseResultPayload(result.text)
          const messages = resultMessages(payload)
          if (messages.length > 0) {
            const message = messages.join(' ')
            setWriteError(message)
            return { ok: false, error: message, warnings: messages }
          }
          setWriteError('')
          const task = taskOfPayload(payload)
          if (task !== null && typeof task.id === 'string') {
            setBoard((current) => current === null ? current : { ...current, tasks: current.tasks.map((entry) => entry.id === task.id ? task : entry) })
          }
          if (options.reload !== false) reload()
          return result
        } finally {
          setBusy(false)
        }
      }

      const save = (id, revision, patch) => {
        run({ op: 'update', id, expectedRevision: revision, patch }, { reload: false })
          .catch((failure) => setWriteError(failure?.message ?? 'Save failed.'))
      }
      const note = (id, text) => {
        const task = tasks.find((entry) => entry.id === id)
        run({ op: 'note', id, expectedRevision: task?.revision, text }, { reload: false })
          .catch((failure) => setWriteError(failure?.message ?? 'The note was not saved.'))
      }
      const action = async (kind, id) => {
        if (kind === 'remove' && !window.confirm('Remove this task from the board? Its child sessions keep running; pause or close first if they should stop.')) return
        if (kind === 'close' && !window.confirm('Close this task as done and interrupt its linked child agents?')) return
        if (kind === 'cancel' && !window.confirm('Cancel this task and interrupt its linked child agents? It stays on the board as cancelled.')) return
        // The command is a compare-and-set like the model tools: the panel must send the
        // revision it is acting on, or the host refuses (needs_revision) instead of silently
        // overwriting an edit that landed in between.
        const task = tasks.find((entry) => entry.id === id)
        const result = await run({ op: kind, id, expectedRevision: task?.revision })
        if (result.ok && kind === 'remove') {
          setSelectedId(null)
          setDetailOpen(true)
        }
      }
      const create = async () => {
        // A task the human starts here is inline: nobody has delegated it to a specialist,
        // and the host refuses a task with neither a role nor inline:true.
        const result = await run({ op: 'create', task: { title: 'New task', objective: '', status: 'open', inline: true } })
        if (result.ok) {
          const task = taskOfPayload(parseResultPayload(result.text))
          if (task !== null && typeof task.id === 'string') setSelectedId(task.id)
        }
      }
      const chooseWorkspace = (value) => {
        const workspace = workspaces.find((entry) => String(entry.workspaceId) === value)
        if (workspace !== undefined) {
          store.set({ sessionId: pickWorkspaceSession(workspace, sessionsById, null), workspaceTitle: workspace.title })
          setSelectedId(null)
        }
      }
      const selectTask = (id) => {
        setSelectedId(id)
        setDetailOpen(true)
      }
      const workspaceId = workspaces.find((entry) => entry.sessionIds?.includes(sessionId))?.workspaceId
      const returnSessionId = typeof state.returnSessionId === 'string' && state.returnSessionId !== '' ? state.returnSessionId : (typeof state.sessionId === 'string' ? state.sessionId : '')
      const returnSession = returnSessionId !== '' ? sessionsById[returnSessionId] : undefined
      const canReturn = returnSession !== undefined
      const goBack = () => { if (canReturn) uiWorkspace.openSession(returnSessionId) }
      const boardAgents = Array.isArray(board?.agents) ? board.agents : []
      // The roster describes the board in view: this chat's roles by default, every role in
      // the workspace read. Reading it off `tasks` reported other chats' specialists here.
      const rosterRows = agentRowsFor(chatTasks, boardAgents, chatId, scope === 'all')
      const rosterTasks = scope === 'all' ? tasks : chatTasks
      const roster = subagentRoster(rosterTasks, rosterRows)
      const rosterCounts = childCounts(roster)
      const roles = roleCounts(roster)
      const rosterLabel = scope === 'all' ? 'Workspace roles' : 'Roles in this chat'
      // The roster row knows the preset a role's child runs with; an older task may carry
      // none of its own, so the list falls back to this.
      const presets = {}
      for (const agent of boardAgents) {
        if (typeof agent?.role === 'string' && typeof agent?.preset === 'string' && agent.preset !== '' && presets[agent.role] === undefined) presets[agent.role] = agent.preset
      }
      return h('div', { className: 'tb-root' },
        h('style', null, CSS),
        h('div', { className: 'tb-top' },
          canReturn ? h('button', { type: 'button', className: 'tb-btn tb-back', onClick: goBack, title: 'Back to the conversation this board was opened from', 'aria-label': 'Back to chat' }, '← Back') : null,
          h('h1', { className: 'tb-title' }, 'Tasks'),
          h('span', { className: 'tb-count', title: scope === 'all' ? `${tasks.length} tasks in this workspace` : `${chatTasks.length} tasks in this chat` }, String(chatTasks.length)),
          h('div', { className: 'tb-viewswitch', role: 'group', 'aria-label': 'Task view' },
            h('button', { type: 'button', className: `tb-viewbtn${viewMode === 'board' ? ' on' : ''}`, onClick: () => setView('board'), 'aria-pressed': viewMode === 'board' }, 'Board'),
            h('button', { type: 'button', className: `tb-viewbtn${viewMode === 'list' ? ' on' : ''}`, onClick: () => setView('list'), 'aria-pressed': viewMode === 'list' }, 'List'),
          ),
          h('select', { className: 'tb-select', value: workspaceId === undefined ? '' : String(workspaceId), onChange: (event) => chooseWorkspace(event.target.value), 'aria-label': 'Workspace' },
            workspaceId === undefined ? h('option', { value: '' }, 'Select workspace') : null,
            workspaces.map((workspace) => h('option', { value: String(workspace.workspaceId), key: String(workspace.workspaceId) }, workspace.title || workspace.path)),
          ),
          h('span', { className: 'tb-spacer' }),
          h('button', { type: 'button', className: 'tb-btn', onClick: reload, title: 'Reload the ledger' }, 'Reload'),
          h('button', { type: 'button', className: 'tb-btn primary', onClick: () => { create().catch(() => {}) }, disabled: busy || !canEdit, title: canEdit ? 'Create a task' : 'Open a live conversation to create a task' }, '+ New task'),
        ),
        !canEdit ? h('div', { className: 'tb-readonly', role: 'status', 'aria-live': 'polite' }, hasSession ? 'Read-only — open a live conversation to edit this board.' : 'Open a live conversation to edit this board.') : null,
        !detailOpen && error ? h('div', { className: 'tb-global-error', role: 'alert' }, error) : null,
        tasks.length > 0 ? h('div', { className: 'tb-filterbar' },
          h('div', { className: 'tb-viewswitch', role: 'group', 'aria-label': 'Board scope' },
            h('button', { type: 'button', className: `tb-viewbtn${scope === 'chat' ? ' on' : ''}`, onClick: () => setScope('chat'), 'aria-pressed': scope === 'chat', title: 'Only the tasks created in this chat' }, 'This chat'),
            h('button', { type: 'button', className: `tb-viewbtn${scope === 'all' ? ' on' : ''}`, onClick: () => setScope('all'), 'aria-pressed': scope === 'all', title: 'Every task in this workspace, including earlier chats' }, 'All chats'),
          ),
          h('input', { className: 'tb-input tb-filter', type: 'search', value: query, onChange: (event) => setQuery(event.target.value), placeholder: 'Filter title, scope, owner…', 'aria-label': 'Filter tasks' }),
          h('select', { className: 'tb-select tb-statusfilter', value: statusFilter, onChange: (event) => setStatusFilter(event.target.value), 'aria-label': 'Filter by status' },
            h('option', { value: 'all' }, 'All statuses'),
            STATUSES.map((status) => h('option', { value: status, key: status }, status)),
          ),
          h('span', { className: 'tb-filtercount', 'aria-live': 'polite', title: 'Shown / tasks in this view' }, `${filteredTasks.length} / ${chatTasks.length}${scope === 'chat' && tasks.length > chatTasks.length ? ` · ${tasks.length - chatTasks.length} elsewhere` : ''}`),
        ) : null,
        h('div', { className: 'tb-roster', role: 'group', 'aria-label': scope === 'all' ? 'Roles in this workspace' : 'Roles linked to this chat' },
          h('span', { className: 'tb-rlabel' }, 'Subagents'),
          h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.total))),
          h('span', { className: 'tb-rsep', 'aria-hidden': true }, '·'),
          h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.active)), ' active'),
          h('span', { className: 'tb-rsep', 'aria-hidden': true }, '·'),
          h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.sleeping)), ' sleeping'),
          rosterCounts.paused > 0 || rosterCounts.linked > 0 ? h('span', { className: 'tb-rsep', 'aria-hidden': true }, '·') : null,
          rosterCounts.paused > 0 ? h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.paused)), ' paused') : null,
          rosterCounts.linked > 0 ? h('span', { className: 'tb-rstat' }, h('b', null, String(rosterCounts.linked)), ' linked') : null,
          h('span', { className: 'tb-rsep', 'aria-hidden': true }, '·'),
          h('span', { className: 'tb-rlabel' }, rosterLabel),
          roles.length === 0
            ? h('span', { className: 'tb-rnone' }, scope === 'all' ? 'none in this workspace' : 'none linked to this chat')
            : h('div', { className: 'tb-rroles' }, roles.map(({ role, count }) => h('span', { className: 'tb-rrole', key: role }, role, ' ', h('b', null, String(count))))),
        ),
        h('div', { className: `tb-body${detailOpen ? '' : ' solo'}` },
          viewMode === 'board'
            ? h('div', { className: 'tb-board', ref: boardRef, role: 'region', 'aria-label': 'Task board' },
              COLUMNS.map((column) => {
                const items = filteredTasks.filter((task) => column.statuses.includes(task.status))
                return h('div', { className: 'tb-col', key: column.id },
                  h('h3', null, column.label, h('span', { className: 'n' }, String(items.length))),
                  items.length === 0 ? h('div', { className: 'tb-empty', style: { padding: '8px 4px', fontSize: '11px' } }, '—') : items.map((task) => h(TaskCard, { key: task.id, task, selected: task.id === selectedId, onSelect: selectTask, chatId, presets })),
                )
              }),
            )
            : h(TaskList, { tasks: filteredTasks, selectedId, onSelect: selectTask, chatId, presets }),
          detailOpen ? h('aside', { className: 'tb-detail', id: 'tb-detail-pane' },
            selected === null
              ? h('div', null,
                h('div', { className: 'tb-detail-head' },
                  h('span', { className: 'tb-kicker' }, 'Task detail'),
                  h('button', { type: 'button', className: 'tb-btn tb-hide', onClick: () => setDetailOpen(false), title: 'Hide the task detail pane', 'aria-controls': 'tb-detail-pane' }, 'Hide'),
                ),
                error ? h('div', { className: 'tb-banner' }, error) : null,
                h('div', { className: 'tb-empty' },
                  !hasSession
                    ? 'Open a live conversation to load and edit this board.'
                    : chatTasks.length === 0
                      ? scope === 'chat'
                        ? (tasks.length === 0
                          ? 'No tasks in this workspace yet. The orchestrator creates them with task_create or delegate_task; you can start one here.'
                          : `No tasks in this chat yet. Switch to All chats to read the ${tasks.length} task${tasks.length === 1 ? '' : 's'} recorded in other chats.`)
                        : 'No tasks in this workspace yet.'
                      : 'Select a task to see its scope, results and timeline.',
                ),
              )
              : h(TaskDetail, { key: selected.id, task: selected, busy, error, canEdit, presets, onHide: () => setDetailOpen(false), onSave: save, onNote: note, onOpenSession: (id) => uiWorkspace.openSession(id), onAction: action, onRefresh: reload }),
          ) : null,
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.workspaceFiles', 'remote.commands', 'uiWorkspace', 'layout'],
      apply(ctx) {
        const store = createStore({ sessionId: null, workspaceTitle: null, returnSessionId: null })
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({ remote: ctx.remote, store, uiWorkspace: ctx.uiWorkspace }),
        }, TasksPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => 'Tasks',
          inject: () => ({ layout: ctx.layout, store }),
        }, PanelIcon))
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'subagent-catalog',
          order: 10,
          inject: (sessionId) => ({ remote: ctx.remote, store, layout: ctx.layout, sessionId }),
        }, TasksTrigger))
      },
    }
  },
})
