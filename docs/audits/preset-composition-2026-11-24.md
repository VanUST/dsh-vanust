> **Историческая запись (design-map v1).** v1 удалён в P3 2026-11-24: файлы модели, сцена-контракт и семь инструментов `designmap_*` больше не существуют; имена ниже — история, не инструкция. Актуальное описание — `docs/DESIGNMAP-V2.md`.

# Preset composition audit, 2026-11-24

Status: audit report. Read-only over the repository and the session store; nothing in
`profile/`, `plugins/` or any persona was edited. The one companion file is
`scripts/audit-preset-composition.mjs`, which re-runs every number below with one command.

## 0. Outcome in ten lines

1. **Every preset's stated tasks map onto tools that exist and that its row grants** — with one
   declaration gap: the `docs` persona promises `bash` and the pinned `lychee` link checker, and the docs
   row (`profile/cordis.patch.yml:675-691`) names no `bash`.
2. **Whether that gap bites is unverified**: the newest `docs` header (25 tools, 2026-11-17) carries
   `bash`, but it predates the allow list, so today's delivery is unknown (section 7).
3. **Dead weight is small where a preset has sessions** (0–10 named tools), and it is **not
   measurable for `presenter`** — no stored session carries that preset.
4. **The 30-tool `mcp__godot__*` family sits in two allow lists** (orchestrator `:499`, ux `:703`), both of which deny it again in `projectDeny`; no session of any preset ever called one of its
   tools, across 1 933 logs and 87 distinct tools actually called.
5. **Context overhead is heaviest on orchestrator**: 50 tools, 57 716 B of schemas (103.1% of its
   `schemaBytes` budget), 29 006 B system prompt (111.6% of `promptBytes`).
6. **The skill catalog is the biggest reminder in 9 of 10 measured presets** — 30–31 KB of 32–36 KB;
   `architect`, which does not grant `skill`, pays 1 505 B instead.
7. **The destructive cache event is a tool-list change, not a re-rendered system section**:
   cache-read collapses to 0.4%–8.8% after one, against 81.1%–99.5% on an unchanged prefix.
8. **All 46 tool-list changes in the corpus are a resume or a change event**, which `freezePerTurn`
   (`plugins/orchestrator/orchestrator.mjs:388-401`) does not cover: it freezes the rendered text per turn,
   not the tool list.
9. **31 prefix changes landed mid-turn** (inside a turn that had already made a request), in 6 of
   the 9 presets that have sessions.
10. **The allow-list row is not the delivered surface** (orchestrator ships 50 tools against 46
    entries), and **ux is red by the gate's own 1.5× rule on its native header** (82 tools against a
    52 allowance) while the gate samples a 1-tool PTC session and prints OK.


## 1. What was asked and what was measured

Three questions about the eleven kit presets, each answered from artefacts on this machine:

- **M1 capability fit** — do the tools a preset is granted cover the tasks its persona states?
  Tasks come from `docs/PRESET-PLAYBOOKS.md` section 3.1 (the usual-taskload column) and from
  the preset's own prefix in `profile/cordis.patch.yml`; the grant comes from the
  `tool-families` row for that preset. Dead weight is a granted tool that no stored session
  of that preset ever invoked.
- **M2 context overhead** — the bytes the first request of a real session carried: persona,
  tool count, tool schemas, system prompt, injected reminders, and each of those against the
  preset's own `promptBytes` budget.
- **M3 prefix-cache churn** — per session, how many distinct system+tool prefixes the requests
  carried, how many prefix changes landed mid-turn (not allowed) versus at a turn boundary
  (allowed), and what the provider charged for them: cache-read tokens as a share of prompt
  tokens, split by what changed.

Reproduce (one command, no arguments):

    node scripts/audit-preset-composition.mjs

It prints the three tables below plus the per-change mechanism table; `--json` prints the same
measurement as one JSON object, `--personas` dumps the eleven persona prefixes, `--limit N` restricts
the decode to N session logs for a smoke run.

## 2. Method, and the two sampling traps it corrects

**The preset in force is the last `agent-preset/selected` event, not the creation header.** A root chat
is created on `standard` and then selects a kit preset; its header says `standard` for the whole
session while the role's tools and persona are the selected preset's. The rule is the same one
`scripts/context-budget.mjs:209-214` applies, so the two readers agree on which session belongs to
which preset. Counting by header alone loses every root chat that switched.

**Depth is not the unit.** `scripts/context-budget.mjs:270` keeps only depth-0 sessions ("a role's canonical
surface is a chat started on that preset"). In this store that excludes almost every kit-preset
session: the roles run as delegated children. Depth-0-only sampling reports 1 of 11 presets as
unmeasured and reads one `ux` session in PTC mode (1 tool) as the `ux` surface. This audit
counts every session whose preset-in-force is the preset, and reports depth and mode beside it.

**Era.** The allow-list policy shipped 2026-11-17 (`profile/cordis.patch.yml:345-357`). Sessions written
before it carry the older, much larger surface (a `docs` child from 2026-11-17 carries 56 tools; the
newest `docs` surface carries 25). The tables take the newest session per preset, so they measure
the row as it stands, and the older sessions still count for dead weight and for cache behaviour.

**Decoding.** Every log is decoded with `scripts/session/session-log.mjs` (`decodeSession`, frame by frame);
a raw `zstd -dc` stops at the first frame and would silently measure a truncated session.

**Corpus.** 1 933 session logs in 33 workspace directories, 2 182 MB; every one is decoded and
**0 are unreadable**. The M2 and M3 tables come from `node scripts/audit-preset-composition.mjs` run at
12:38 (1 932 logs — the extra one is this audit's own session, which grew between runs); the M1
dead-weight column and the task matrix come from `node scripts/audit-preset-composition.mjs --json` run at
13:08.

**The profile moved under the audit.** `profile/cordis.patch.yml` is modified in the working tree
(`git status --short` prints ` M profile/cordis.patch.yml`, HEAD `d37fd2d`) and its mtime is 12:47,
between the two runs: the orchestrator row went from 42 to 46 entries and the architect row from
12 to 16 (four `map_*` tools). Every "row entries" number below is the 13:08 revision. The M2
numbers measure real request headers from stored sessions, which no later profile edit changes.

**A tool reached through `run_code` is still a tool call.** A PTC session logs the inner call as
`tool/ptc-dispatch` with the real tool name; counting only `tool/call` reads every tool a PTC session
used as unused. The first pass of this audit made that mistake and reported 3–10 phantom dead
tools per preset; the numbers here count both event types.



## 3. M1 — capability fit

Coverage is the share of the preset's stated tasks whose every required tool the row grants.
A gap names the task it blocks. Citations: each task's persona fragment is in
`scripts/audit-preset-composition.mjs` (`MATRIX`), each grant's profile line is printed by `--json`.

| preset | stated tasks | declared coverage | row entries | delivered header (newest native) | dead weight: granted, never invoked | PTC sessions |
|---|---|---|---|---|---|---|
| orchestrator | 7 | 100% | 46 | 50 tools, 2026-11-24 | codex_signin_cancel, codex_signin_start, codex_signin_status (3); the four map_* tools entered the row at 12:47 today, too new to judge; + family mcp__godot__* (30 tools) | 0 |
| architect | 4 | 100% | 16 | 16 tools, 2026-11-23 | none (the four map_* tools entered the row at 12:47 today, too new to judge) | 0 |
| ux | 5 | 100% | 19 | 82 tools, 2026-11-17 † | none + family mcp__godot__* (30 tools) | 39 of 58 |
| presenter | 4 | 100% | 22 | **no session** | **unmeasurable** (no session; 24 Playwright tools would be the shape of it) | 0 |
| backend | 5 | 100% | 16 | 56 tools, 2026-11-17 † | none | 151 of 214 |
| research | 4 | 100% | 15 | 16 tools, 2026-11-23 | none | 0 |
| gatherer | 3 | 100% | 11 | 36 tools, 2026-11-17 † | read_image, todo_write, working_directory (3) | 7 of 15 |
| reviewer | 4 | 100% | 15 | 24 tools, 2026-11-17 † | glob (1) | 2 of 25 |
| critic | 5 | 100% | 15 | 23 tools, 2026-11-17 † | case_run, present, todo_write (3) | 4 of 14 |
| tester | 5 | 100% | 28 | 28 tools, 2026-11-23 | case_deprecate, case_suite, case_verify, glob, grep, job_list, skill, todo_write, web_search, working_directory (10) | 0 |
| docs | 5 | **80%** | 15 | 25 tools, 2026-11-17 † | outline, web_search (2) | 3 of 17 |

† the newest native header predates the allow list, so the delivered column shows the older,
larger surface. For those presets the row is measured, the delivery is not.

**The one gap.** `docs` needs `bash` for the task its persona states — "Your tools: bash and the
pinned `lychee` link/anchor checker (`--offline` keeps a run hermetic); the kit's own doc gate is
`make verify`" — and the row (`profile/cordis.patch.yml:675-691`) has no `bash`. The task it blocks is
"check links and run the doc gate". Whether the tool arrives anyway through the preset's own
plugin rows is what section 7 leaves unverified; the row, which is what the budget and the gate
read, does not grant it.

**Dead weight, and how much to trust it.** Four notes:

- **The Godot family is dead everywhere.** The family is allowed to orchestrator and ux and
  denied again by `projectDeny` in both rows; across 1 933 logs and 87 distinct
  tools actually called, **zero** calls name a `mcp__godot__` tool.
- **Playwright is used, but not whole.** 17 of its 24 tools were called, all of them by `ux`
  sessions; the other 7 never were.
- **A small session count is weak evidence.** `tester` has 2 sessions, `research` 17, `docs` 17: a tool marked
  unused there may simply be untested, not unwanted. `presenter`'s first-pass "21 of 22" is exactly this
  artefact; it is reported as unmeasurable, not as dead weight.
- **PTC sessions are counted through their inner calls** (`tool/ptc-dispatch` carries the real tool
  name). Counting only `tool/call` would read every `run_code`-reached tool as unused — the first run
  of this audit did exactly that, and the numbers above are the corrected run.

**The full matrix: every stated task, the tools it needs, and what the row leaves out.**
Generated from the same JSON (the capability object in --json).

| preset | task (persona fragment) | tools the task needs | missing from the row |
|---|---|---|---|
| orchestrator | open, update and close a task — "Work flows through the taskboard: open the task" | task_create, task_update, task_close, task_get, task_list | none |
| orchestrator | delegate with a self-contained brief — "delegate with a self-contained brief" | delegate_task, delegation_brief | none |
| orchestrator | judge the evidence a child returned — "then judge the result" | case_get, case_list, read | none |
| orchestrator | keep the design map current — "Keep the system-design map current whenever the design changes" | designmap_apply, designmap_lint | none |
| orchestrator | edit a file itself — "you can create and edit files yourself" | write, edit, read, glob, grep | none |
| orchestrator | web research for a decision — "web research and the design-map tool" | web_search, web_fetch | none |
| orchestrator | record and check the analysis record — "Keep the system-design map current" | analysis_upsert, analysis_check | none |
| architect | read only the named file or subsystem — "read, grep, glob, outline on named files or a named subsystem" | read, grep, glob, outline | none |
| architect | delegate one gatherer instead of surveying — "delegate ONE GATHERER with delegate_task" | delegate_task | none |
| architect | record a design change in the design map — "Record a design change in the design map with designmap_apply" | designmap_apply, designmap_lint, designmap_status | none |
| architect | leave the decision on its task — "answer in one text: the decision, why it is the right one" | task_note | none |
| ux | render, snapshot and screenshot a page in a real browser — "Build and prove in a real browser with Playwright" | mcp__playwright__* | none |
| ux | run the accessibility and screenshot-diff drivers with node — "pinned .tools libraries for accessibility audits (axe-core with pla..." | bash | none |
| ux | author the interface — "designs and proves an interface" | write, edit | none |
| ux | read the code it is designing against — "designs and proves an interface" | read, grep, glob, outline | none |
| ux | file the case library entry — "the state matrix in a browser" | case_record, case_list | none |
| presenter | author and render the deck or dashboard — "the kit presentation/dashboard/diagram tools" | presentation, dashboard, diagram, write, edit | none |
| presenter | verify slide by slide in a browser — "Then verify in the browser: open the file, screenshot every slide, ..." | mcp__playwright__*, read_image | none |
| presenter | run the renderer and a local server — "Your tools: bash, the file tools" | bash, job_output | none |
| presenter | collect references — "web research for references" | web_search, web_fetch | none |
| backend | edit the implementation — "implements the change" | write, edit | none |
| backend | run the build, the test and the pinned analysers — "Your tools: bash plus the pinned depcruise, semgrep and oasdiff" | bash | none |
| backend | measure the case on the product — "Run the product once at the boundary of the change and quote comman..." | case_run, case_record, case_get | none |
| backend | read the code around the change — "implements the change" | read, grep, glob, outline | none |
| backend | report on its own task — "implements the change" | task_get, task_note | none |
| research | search and fetch the web — "Your tools: web_search/web_fetch" | web_search, web_fetch | none |
| research | search the papers tools — "the papers tools" | papers_search, papers_trending, papers_download | none |
| research | read the repository and the source — "read-only repository search" | read, grep, glob, outline | none |
| research | write the ranked answer — "Deliver a short ranked answer with URLs" | write | none |
| gatherer | run read-only commands — "Run read-only commands only (git log, rg, wc, ls)" | bash | none |
| gatherer | read and search the code — "the mechanism and call path" | read, grep, glob, outline | none |
| gatherer | return a cited report — "Return one compact report, not a transcript of your reading" | task_note | none |
| reviewer | run the change and the pinned diff/secrets/dependency tools — "Your tools: bash plus the pinned difft, betterleaks and osv-scanner" | bash | none |
| reviewer | judge the case provenance — "the diff + a run" | case_gate, case_get, case_run | none |
| reviewer | read the diff and the code — "Do not edit code; the orchestrator routes fixes" | read, grep, glob, outline | none |
| reviewer | report the verdict on the task — "the diff + a run" | task_get, task_note | none |
| critic | run the product and quote command, output and exit code — "the exact command, the fixture, the observed output or exit code" | bash | none |
| critic | read the code under attack — "find realistic, non-trivial inputs" | read, grep, glob, outline | none |
| critic | read and run the case library — "a finding without the exact command, fixture and smallest input" | case_get, case_list, case_run | none |
| critic | read a long negative run — "Track every background job id you start" | job_output | none |
| critic | report to the orchestrator — "Report to the orchestrator with severity, reproduction" | task_note | none |
| tester | write the case and its driver — "Write the case and its driver under docs/cases/ or a test root" | write, edit, case_record | none |
| tester | measure a red against the wrong product and a green against the change — "Measure TWO runs, not one: the RED against the previous version" | case_run, bash | none |
| tester | gate the case on provenance — "the two runs" | case_gate, case_get | none |
| tester | read the product under test — "you never fix what you test" | read, grep, glob, outline | none |
| tester | list the cases so a new one is not a duplicate — "the case library" | case_list, case_get | none |
| docs | edit the documents — "delete or rewrite stale pages instead of adding another" | write, edit | none |
| docs | check links and run the doc gate — "Your tools: bash and the pinned lychee link/anchor checker; the kit..." | bash | bash |
| docs | verify a cited link over the web — "refuse to produce documents nobody will read" | web_fetch, web_search | none |
| docs | read the code a page describes — "prefer inline comments and the code itself" | read, grep, glob, outline | none |
| docs | file the intake case — "keeps documentation true" | case_record | none |

docs latest names: analysis_check analysis_impact analysis_read analysis_upsert bash case_get case_list case_record delegate_task edit glob grep job_kill job_list job_output present read read_image skill task_get task_note todo_write web_fetch web_search write

## 4. M2 — context overhead

| preset | measured session | persona B (share of promptBytes) | tools | schema B (share of schemaBytes) | system B (share of promptBytes) | reminders B (share of remindersBytes) |
|---|---|---|---|---|---|---|
| orchestrator | `session-…` root, 2026-11-24 | 1 559 (6.0%) | 50 | 57 716 (103.1%) | 29 006 (**111.6%**) | 36 260 (51.8%) |
| architect | `ec0363ab` child, 2026-11-23 | 1 586 (13.2%) | 16 | 11 570 (57.9%) | 10 133 (84.4%) | 1 505 (9.4%) |
| ux | `5fdb64a4` child, 2026-11-17 † | 1 114 (4.3%) | 82 | 62 786 (**104.6%**) | 12 530 (48.2%) | 31 568 (45.1%) |
| presenter | **unmeasured — no session** | 2 318 (8.9%) | — | — | — | — |
| backend | `6d334fff` child, 2026-11-17 † | 1 234 (4.7%) | 56 | 42 454 (94.3%) | 12 540 (48.2%) | 31 568 (45.1%) |
| research | `8f552bdd` child, 2026-11-23 | 1 040 (4.0%) | 16 | 9 774 (23.3%) | 10 966 (42.2%) | 32 710 (46.7%) |
| gatherer | `19f1028a` child, 2026-11-17 † | 1 639 (6.3%) | 36 | 26 785 (89.3%) | 10 901 (41.9%) | 31 568 (45.1%) |
| reviewer | `session-…` root, 2026-11-17 † | 996 (3.8%) | 24 | 23 776 (55.3%) | 23 749 (91.3%) | 34 188 (48.8%) |
| critic | `session-…` root, 2026-11-17 † | 1 691 (6.5%) | 23 | 23 317 (58.3%) | 24 446 (94.0%) | 34 188 (48.8%) |
| tester | `90492cda` child, 2026-11-23 | 1 950 (7.5%) | 28 | 27 152 (54.3%) | 15 463 (59.5%) | 32 728 (46.8%) |
| docs | `session-…` root, 2026-11-17 † | 905 (3.5%) | 25 | 26 546 (59.0%) | 23 867 (91.8%) | 34 188 (48.8%) |

† measured before the allow list shipped on 2026-11-17: the delivered surface is the older,
larger one, so the tool count and schema bytes overstate today's row (section 7).

**What the bytes are.** The persona is the smallest part of every header: 905–2 318 B, 3.5–13.2%
of `promptBytes`. The system prompt is 10–29 KB. The **skill catalog is the largest
reminder in nine of the ten measured presets** — 30 304 B of 34 188 B for reviewer, critic and
docs (88.6%), 31 464 B of 36 260 B for orchestrator (86.8%) — and `architect`, the one preset that
does not grant `skill`, pays 1 505 B of reminders instead of ~34 KB. Tool schemas are the
largest single contributor where the vendor families are wide: `ux` 62 786 B (Playwright
alone is 24 tools), orchestrator 57 716 B, backend 42 454 B.

Two presets exceed their own tool-schema budget on the measured header: orchestrator (57 716 of
56 000) and ux (62 786 of 60 000); orchestrator is also over its `promptBytes` budget (29 006 of
26 000). No preset is within 1.5× its tool allowance, so none is RED by the gate's own rule
(`make verify` counts a count above 1.5 × `tools` as red).

**One preset is red by the gate's own rule, and the gate cannot see it.** `ux` measured 82 tools
against a `tools: 52` allowance (`profile/cordis.patch.yml:389`): 82 > 1.5 × 52 = 78, which
`scripts/context-budget.mjs:317` treats as RED. The gate reads a `ux` session at depth 0; in this store
that is a PTC session with 1 tool, so it prints OK. The measured native surface is red, the
sampled one is green.

**PTC is the majority mode for three presets.** 151 of backend's 214 sessions, 39 of ux's 58 and
7 of gatherer's 15 run in PTC mode (1 tool in the header, a ~53 KB system prompt). Their M2 rows
are native headers on purpose — the byte budget is a native-surface budget, and mixing the two
modes would compare two different costs.



## 5. M3 — prefix-cache churn

| preset | sessions | sessions with >1 request | median distinct prefixes | tool-list changes | system re-renders | mid-turn | turn boundary | cache-read share | after a tool-list change | after a system re-render | unchanged prefix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| orchestrator | 70 | 22 | 2 | 13 | 826 | 18 | 821 | 97.4% | **8.8%** | 93.1% | 98.6% |
| architect | 13 | 7 | 1 | 0 | 0 | 0 | 0 | 77.8% | — | — | 81.1% |
| ux | 58 | 51 | 1 | 7 | 6 | 4 | 9 | 99.1% | **2.8%** | 65.8% | 99.2% |
| presenter | **unmeasured — no session** | — | — | — | — | — | — | — | — | — | — |
| backend | 214 | 205 | 1 | 18 | 11 | 5 | 24 | 99.4% | **3.7%** | 71.1% | 99.5% |
| research | 17 | 11 | 1 | 2 | 1 | 1 | 2 | 97.0% | **0.4%** | 16.2% | 98.0% |
| gatherer | 14 | 8 | 1 | 0 | 1 | 0 | 1 | 99.1% | — | 90.2% | 99.2% |
| reviewer | 25 | 18 | 1 | 1 | 1 | 0 | 2 | 98.8% | **0.8%** | 84.5% | 99.0% |
| critic | 14 | 8 | 1 | 1 | 2 | 1 | 2 | 99.1% | **2.7%** | 78.6% | 99.2% |
| tester | 2 | 2 | 1 | 0 | 0 | 0 | 0 | 99.4% | — | — | 99.5% |
| docs | 17 | 11 | 1 | 4 | 5 | 2 | 7 | 99.1% | **0.8%** | 79.0% | 99.4% |

"prefix" here is the pair (every system message appended so far, the tool list of the last
`request/header`). A change is **mid-turn** when a request of the same turn already ran and the
prefix then moved — the cache that would have been reused inside the turn is gone; a change on a
new turn is the allowed boundary. "Cache-read share" is `cacheReadTokens / (inputTokens + cacheReadTokens)`
from the usage series, summed over the preset's sessions.

**The mechanism, and where to see it.** Two events change the prefix, and they cost differently:

- **A `request/header` whose tool list differs from the previous one** — All 46 tool-list
  changes in the corpus carry `reason: resume` or `reason: change`. This is the destructive class:
  91%–99.6% of the prompt is re-billed (cache-read 0.4%–8.8%). Visible as a second
  `request/header` record whose `header.tools` differ from the previous one.
- **A `system/message` appended with different text** — 853 of the 899 prefix changes. The harness
  writes it into history (request/context carries systemPromptUpdate in-history), so the earlier
  bytes stay a valid prefix and the cost is the re-billed tail (cache-read 16%–93%). Visible as
  another `system/message` record. The diff between two of them, in the orchestrator's sessions,
  is the **board digest**: `- BACKEND [backend] - 2 tasks, active | - RESEARCH [research] - 1 task, sleeping`
  changes between steps — the block `freezePerTurn` exists to hold still.

## 6. Rankings and the worst preset on each metric

**M1 capability fit — best is a tie, the worst is docs (80%).** Every preset's stated tasks are
covered except one: the docs persona says "Your tools: bash and the pinned `lychee` link/anchor
checker ... the kit's own doc gate is `make verify`" while the docs row
(`profile/cordis.patch.yml:675-691`) grants no `bash`. The docs role cannot run the link
check or `make verify` its own persona names. Every other preset covers 100% of its stated
tasks; dead weight, not coverage, separates them (table above). Presenter ranks nowhere on this
metric because dead weight needs a session and it has none.

**M2 context overhead — worst is orchestrator.** 50 tools and 57 716 B of tool schemas is the
largest header of the eleven, 103% of its own `schemaBytes: 56000` budget
(`profile/cordis.patch.yml:371`), and its 29 006 B system prompt is 111.6% of `promptBytes: 26000`
(`:372`). The runner-up is `ux` at 82 tools / 62 786 B — but that is a 2026-11-17 session,
before the allow list, so it measures a surface the row no longer grants (see section 7).

**M3 prefix-cache churn — worst is research by cost per change, orchestrator by volume.** The
destructive event is a **tool-list change**, not a re-rendered system section: after a tool-list
change the provider served **0.4%–8.8%** of the prompt from cache across the presets (research
0.4%, reviewer 0.8%, docs 0.8%, critic 2.7%, ux 2.8%, backend 3.7%, orchestrator 8.8%), against
**81.1%–99.5%** on requests whose prefix did not change. A re-rendered system section costs far
less (16.2%–93.1%, and the low end is a two-request session, so it is noise). Orchestrator has
the most of both: 826 system re-renders and 13 tool-list changes across 70 sessions, 18 of the
changes mid-turn. Critic has the largest single mid-turn event: session `17b7638e`, turn 3, step 37 —
a system re-render 37 steps into a turn.

## 7. Blind spots, unmeasured presets, and what this audit does not say

- **`presenter` is unmeasured, not zero.** Of 1 933 stored logs, none carries `presenter` as the
  preset in force — no native session and no PTC session. Its M2 and M3 cells are empty by fact;
  its first-pass "21 of 22 granted tools never invoked" was an artefact of having no session and
  is reported as unmeasurable. Its M1 line (4 tasks, 100% covered) comes from the profile alone.
- **Seven presets have no native session after the allow list shipped**: `ux`, `backend`, `gatherer`,
  `reviewer`, `critic` and `docs` (newest 2026-11-17) and `presenter` (none). Their M2 rows show the
  newest native header that exists, so for these six the tool count and schema bytes measure a
  surface the row no longer grants. Only `orchestrator` (2026-11-24), `architect`, `research` and `tester`
  (2026-11-23) measure a post-allow-list header. Their M3 rows are unaffected: they count every
  session, old and new.
- **Cache-read share is not comparable across presets with different session lengths.** `architect`
  sits at 77.8% because its sessions are short (1–7 requests), so little of any prompt is ever
  served from cache; a long `backend` session reaches 99.4%. The per-class split (after a change
  versus unchanged) is the comparable number, not the headline share.
- **PTC sessions are counted apart.** A PTC session carries one tool (`run_code`) and re-bills a
  ~53 KB system prompt; mixing it into M2 would read as a tiny surface. The script records the
  PTC session count per preset (`ptcSessions` in `--json`) and never uses it for the M2 row.
- **The delivered surface is not the allow-list row.** Measured headers carry tools the row does
  not name: orchestrator delivers 50 tools against 46 entries (goal tools, the full designmap
  family, `read_image`); architect delivers 16 against 16 but with the designmap export/open/render/scan
  tools and `read_image` in place of the two entries it does not deliver. The preset's own plugin
  rows register those and `tools.restrict` cannot mask them, so dead weight is computed on the row
  (what the profile grants) with the measured count beside it.
- **Four tools in the orchestrator and architect rows are minutes old.** `map_edit`, `map_list`,
  `map_read`, `map_render` entered `profile/cordis.patch.yml` at 12:47 today; no session has had a chance
  to use them, so they are reported as new, not as dead weight.
- **All 46 tool-list changes in the corpus are a resume or a change event** (`request/header:resume` 40,
  `:change` 6), which `freezePerTurn` (`plugins/orchestrator/orchestrator.mjs:388-401`, unchanged in the
  working tree at the time of this audit) does not cover: it memoises one text block per turn,
  not the tool list.
- **`case_judge` does not exist.** `docs/PRESET-PLAYBOOKS.md` section 3.1 names it as the tester's
  catch ("case_judge reasons"); no plugin registers a tool of that name (`grep -r case_judge plugins/`
  returns nothing). The tester row is not at fault; the playbook line is stale.
- **Not measured:** whether the personas' wording is right (that is the playbook audit's
  question), the cache behaviour of a provider other than the one in the usage records, and the
  reminder bytes a preset would carry with a different skill catalog.


## 8. Recommendations (nothing edited)

1. **docs: grant `bash` or drop the sentence.** The persona promises `bash` and `lychee`; the row does not
   grant it. Pick one: add `bash` to `profile/cordis.patch.yml:675-691`, or rewrite the persona line so
   the doc gate is delegated. (M1 gap, one line either way.)
2. **orchestrator: remove `mcp__godot__*` from the allow list** (`:499`). The comment above the
   table already states "No row allows `mcp__godot__*`" (`:355`); the row contradicts it, and the
   family is 30 tools the header does not need in a workspace without `project.godot`.
3. **Freeze the tool list per turn as well as the prompt text.** The measured cost of a tool-list
   change is 91%–99.6% of the prompt re-billed (`after a tool change` column), while the
   `freezePerTurn` block only covers the rendered text. The smallest change is to compare the
   header's tool list with the previous request's and reuse it inside a turn.
4. **Give the presenter a session before its composition is judged.** One real `presenter` task
   turns 21 unknown cells into numbers.
5. **Re-measure ux, backend, gatherer, reviewer, critic and docs after one native session each.** Their M2 rows are
   pre-allow-list; one session each replaces a stale row.


## 9. Reproduction log

Every row above comes from one of these runs, in this checkout (`/home/iustimov/dsh-kit`, HEAD `d37fd2d`):

    $ node scripts/audit-preset-composition.mjs            # exit 0, 1 932 logs, prints the three tables
    $ node scripts/audit-preset-composition.mjs --json     # exit 0, 1 933 logs, 132 222 B of JSON
    $ node scripts/audit-preset-composition.mjs --personas # exit 0, the eleven prefixes and their bytes
    $ node scripts/context-budget.mjs                      # exit 0, the gate's own view: 1/10 within budget,
                                                           #   "ux (ptc) | 1 | 2 | 40 | 2 500 | 40 344 | OK"
    $ git status --short profile/cordis.patch.yml          # " M profile/cordis.patch.yml" (edited at 12:47)
    $ grep -r case_judge plugins/ | wc -l                  # 0

Files created by this audit: this report and `scripts/audit-preset-composition.mjs`. Nothing else in the
repository, the profile, the plugins or the session store was written.

