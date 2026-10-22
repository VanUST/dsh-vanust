# @cc/dsh-handoff

One page, not a report.

`handoff` takes a structured result — title, audience, objective, TL;DR, what
changed, evidence as claim/proof pairs, decisions, risks, next actions and
artifacts — and writes a self-contained A4 HTML page into the workspace. When a
Chrome/Chromium launcher is installed (or `CHROME_PATH` names one), it also prints
a PDF beside it with `--headless=new --print-to-pdf`.

The HTML is the source of truth: inline CSS, system fonts, no external asset, so
the file the Sidebar previews is the file that prints. A missing browser is a
warning, not a failure; the HTML is always produced.

The page follows `clear-writing`: the main idea first, one topic per paragraph,
evidence in a table, risks with a mitigation, and a hard cap on every list so the
handoff cannot grow into a status report. Use `present` to show it; use `diagram`
separately when a relationship needs a visual.
