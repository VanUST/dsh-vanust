/**
 * PURPOSE
 *   Render a structured handoff into one self-contained A4 HTML page. The page is
 *   the artifact: it prints without a server, embeds no external asset, and reads
 *   in one pass. The prose follows `clear-writing`; the structure is fixed so a
 *   handoff cannot grow into a report by accident.
 *
 * INPUTS
 *   A spec: title, audience, tldr[], objective, changed[], evidence[{claim,proof}],
 *   decisions[{decision,why}], risks[{risk,impact,mitigation}], next[], artifacts[].
 *
 * OUTPUTS
 *   `{ html, warnings }`; `html` is null only for a spec with no title. Every list
 *   is bounded, so a caller cannot produce a forty-page handoff by passing one.
 *
 * KEYWORDS
 *   handoff, one page, HTML, print, A4, clear writing
 *
 * BEHAVIOUR ON EDGE CASES
 *   - A missing title yields html: null; every other missing field is rendered as
 *     "not stated" rather than omitted silently.
 *   - Lists are capped (5 tldr, 8 evidence, 6 decisions, 6 risks, 6 next, 12
 *     artifacts) and the cap is reported in `warnings`.
 *   - Every value is escaped; a claim containing `<` is text, not markup.
 */

/** Escape the five markup-significant characters. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A filename-safe slug. */
export function slug(value) {
  return String(value ?? 'handoff')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'handoff'
}

/** Coerce a value to a bounded string. */
function text(value, limit = 4000) {
  return value === null || value === undefined ? '' : String(value).slice(0, limit)
}

/** Bounded array of strings. */
function list(value, limit) {
  if (!Array.isArray(value)) return { items: [], dropped: 0 }
  const items = value.filter((entry) => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim())
  return { items: items.slice(0, limit), dropped: Math.max(0, items.length - limit) }
}

/** Bounded array of objects with the named string fields. */
function objects(value, fields, limit) {
  if (!Array.isArray(value)) return { items: [], dropped: 0 }
  const items = value
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => Object.fromEntries(fields.map((field) => [field, text(entry[field], 1200)])))
    .filter((entry) => fields.some((field) => entry[field] !== ''))
  return { items: items.slice(0, limit), dropped: Math.max(0, items.length - limit) }
}

const CSS = `
:root{--ink:#161a20;--ink2:#3d4652;--muted:#6b7480;--line:#dde1e7;--paper:#fff;--bg:#eef0f3;--accent:#2f6fed;--ok:#0b7a52;--warn:#9a6700;--bad:#b42318}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:11.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;margin:14px auto;background:var(--paper);padding:14mm 15mm 12mm;box-shadow:0 10px 30px rgba(0,0,0,.08)}
header{display:flex;align-items:flex-start;gap:14px;border-bottom:2px solid var(--ink);padding-bottom:9px;margin-bottom:10px}
header h1{font-size:20px;line-height:1.15;margin:0;letter-spacing:-.02em}
header .meta{margin-left:auto;text-align:right;color:var(--muted);font-size:9.5px;line-height:1.5;white-space:nowrap}
.kicker{font-size:9px;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.lede{margin:0 0 9px;color:var(--ink2);font-size:11.8px}
h2{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:10px 0 4px;border-bottom:1px solid var(--line);padding-bottom:2px}
p{margin:3px 0;color:var(--ink2)}
ul,ol{margin:3px 0;padding-left:16px;color:var(--ink2)}
li{margin:2px 0}
.tldr{background:#f5f8ff;border-left:3px solid var(--accent);padding:7px 10px;margin:0 0 8px}
.tldr ul{margin:2px 0}
table{width:100%;border-collapse:collapse;font-size:10.4px;margin:3px 0 6px;table-layout:fixed}
th,td{text-align:left;vertical-align:top;padding:4px 5px;border-bottom:1px solid #eceff3}
th{background:#f6f7f9;color:var(--muted);font-size:8.6px;text-transform:uppercase;letter-spacing:.05em}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:9.4px;background:#f3f5f8;border:1px solid #e6e9ee;border-radius:3px;padding:0 3px;overflow-wrap:break-word}
.muted{color:var(--muted)}
.badge{display:inline-block;border-radius:999px;padding:1px 6px;font-size:8.6px;font-weight:700;border:1px solid var(--line);color:var(--muted)}
.foot{display:flex;gap:10px;border-top:1px solid var(--line);margin-top:10px;padding-top:7px;color:var(--muted);font-size:9px}
.foot .one{margin-left:auto;text-align:right}
@media print{html,body{background:#fff}.page{margin:0;box-shadow:none;width:auto;min-height:0;padding:0}@page{size:A4;margin:12mm}}
`

/**
 * Render the one-page handoff.
 *
 * @param spec - The structured handoff.
 * @returns `{ html, warnings }`.
 */
export function renderHandoff(spec) {
  const warnings = []
  const title = typeof spec?.title === 'string' ? spec.title.trim() : ''
  if (title === '') return { html: null, warnings: ['title: expected a non-empty string'] }

  const tldr = list(spec?.tldr, 5)
  const changed = list(spec?.changed, 8)
  const evidence = objects(spec?.evidence, ['claim', 'proof'], 8)
  const decisions = objects(spec?.decisions, ['decision', 'why'], 6)
  const risks = objects(spec?.risks, ['risk', 'impact', 'mitigation'], 6)
  const next = list(spec?.next, 6)
  const artifacts = list(spec?.artifacts, 12)
  for (const [label, result] of [['tldr', tldr], ['changed', changed], ['evidence', evidence], ['decisions', decisions], ['risks', risks], ['next', next], ['artifacts', artifacts]]) {
    if (result.dropped > 0) warnings.push(`${label}: dropped ${result.dropped} item(s) over the one-page cap`)
  }

  const e = escapeHtml
  const tldrHtml = tldr.items.length > 0
    ? `<div class="tldr"><ul>${tldr.items.map((item) => `<li>${e(item)}</li>`).join('')}</ul></div>`
    : `<p class="muted">No TL;DR stated.</p>`
  const changedHtml = changed.items.length > 0 ? `<ul>${changed.items.map((item) => `<li>${e(item)}</li>`).join('')}</ul>` : '<p class="muted">No change list stated.</p>'
  const evidenceHtml = evidence.items.length > 0
    ? `<table><thead><tr><th style="width:38%">Claim</th><th>Proof</th></tr></thead><tbody>${evidence.items.map((item) => `<tr><td>${e(item.claim)}</td><td>${e(item.proof)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No evidence stated. A claim without proof is not a result.</p>'
  const decisionsHtml = decisions.items.length > 0
    ? `<ul>${decisions.items.map((item) => `<li><b>${e(item.decision)}</b>${item.why === '' ? '' : ` — ${e(item.why)}`}</li>`).join('')}</ul>`
    : '<p class="muted">No decisions recorded.</p>'
  const risksHtml = risks.items.length > 0
    ? `<table><thead><tr><th style="width:26%">Risk</th><th style="width:30%">Impact</th><th>Mitigation / next check</th></tr></thead><tbody>${risks.items.map((item) => `<tr><td>${e(item.risk)}</td><td>${e(item.impact)}</td><td>${e(item.mitigation)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No risks recorded.</p>'
  const nextHtml = next.items.length > 0 ? `<ol>${next.items.map((item) => `<li>${e(item)}</li>`).join('')}</ol>` : '<p class="muted">No next actions stated.</p>'
  const artifactsHtml = artifacts.items.length > 0 ? `<ul>${artifacts.items.map((item) => `<li><code>${e(item)}</code></li>`).join('')}</ul>` : '<p class="muted">No artifacts attached.</p>'

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator" content="dsh-handoff">
<title>${e(title)} — handoff</title><style>${CSS}</style></head>
<body><div class="page">
<header><div><div class="kicker">Handoff${spec.audience ? ` · for ${e(text(spec.audience, 120))}` : ''}</div><h1>${e(title)}</h1></div><div class="meta">${e(new Date().toISOString().slice(0, 10))}<br>DeepSeek Harness</div></header>
${spec.objective ? `<p class="lede"><b>Objective.</b> ${e(text(spec.objective, 1200))}</p>` : ''}
${tldrHtml}
<h2>What changed</h2>${changedHtml}
<h2>Evidence</h2>${evidenceHtml}
<h2>Decisions</h2>${decisionsHtml}
<h2>Risks and unknowns</h2>${risksHtml}
<h2>Next actions</h2>${nextHtml}
<h2>Artifacts</h2>${artifactsHtml}
<div class="foot"><div>One page is the point. If it needs more, the task was not decomposed enough.</div><div class="one">HTML is the source of truth; PDF is a convenience.</div></div>
</div></body></html>`
  return { html, warnings }
}
