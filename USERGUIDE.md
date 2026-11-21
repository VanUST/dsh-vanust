# USERGUIDE.md — setting up and starting the harness on a new machine

This kit installs **DeepSeek Harness (dsh)** on any of your machines (2× Linux,
1× Windows) plus the **28** plugins this deployment adds beyond upstream:
**`@cc/dsh-notify`** (raises a desktop notification — `notify-send`, a PowerShell toast or
`osascript` — when an agent finishes a turn and when it asks you a question; silence it with
`DSH_NOTIFY_DISABLED=1` in the server's environment),
**`@cc/dsh-image-window`** (keeps only the newest screenshot in the request: the image that
falls out of the window is offloaded as a new one arrives, so the provider re-bills the new
batch instead of the whole context),
**`@cc/dsh-tail-pruner`** (holds a session under a token budget by pruning the newest over-sized
tool results first, so the point where the provider's prefix cache breaks stays at the tail; the
harness's own pruner rewrites from the oldest, which re-bills almost the whole context — the two
tokens of advice are `budgetRatio` and `protectResults`),
**`@cc/dsh-diagrams`** (one tool that renders a JSON diagram spec into a standalone
HTML document with inline SVG — flowcharts and algorithm illustrations, layered system
designs, sequence diagrams and state machines; you describe nodes and relationships and
the plugin computes the geometry, and the Sidebar document preview shows it),
**`@cc/dsh-presentation`** (two tools over one style system: `presentation` renders a JSON
deck spec into a standalone HTML deck and `dashboard` renders a KPI board — five themes,
fragments that reveal on advance, count-up numbers, drawn chart lines, an overview grid,
speaker notes and one printed slide per page; the file needs no network and no sibling
asset, so the Sidebar preview shows exactly what you print),
**`@cc/dsh-work-modes`** (shipped but not mounted: its two-child concurrency cap was
removed on 2026-11-05 and the harness pool now allows 64 concurrent `subagent`
children), **`@cc/dsh-godot-mcp`** (a declarative, transferable MCP server list — §3.2),
**`@cc/dsh-skills`** (twenty runtime skills: Ponytail, grill-me/grilling, Karpathy
clear-writing/explain-webpage/explain-diagram, the UI builder loop, the proof-not-tests
ruling, literature review, and the 2026-11-09 UX/UI testing set: canvas bridge, property
tests, visual goldens, a11y/keyboard audit, Maestro flows, run observability),
**`@cc/dsh-flash-guard`** (refuses a delegated child's model route unless it is one of the
allowed routes; the old effort cap is gone because the effort is part of the frozen selection),
**`@cc/dsh-role-model`** (a role's own route before a fresh session's first request, and a
fallback on a quota failure that retries the step instead of failing the turn — the `architect`
role runs on `gpt-6.2-sol` and falls back to `deepseek-flash` at max effort),
**`@cc/dsh-tool-families`** (per-preset MCP/tool families: a family leaves the request
header instead of staying in it unused), **`@cc/dsh-proof-guard`** (denies a test-file write
without a `PROOF:` header),
**`@cc/dsh-state-feed`** (delivers the state into the conversation: L1 once as the first
message of a root session, L2 as one aggregated delta at a turn boundary when the projection
hash changed; workers and stateless workspaces get nothing),
**`@cc/dsh-project-state`** (the state core, `ccProjectState`: the single writer of `state/` —
REQ/DECISION/TASK/TEST files, IDs under a lock, links with a content hash, CAS, journal replay,
`verify()`; no model tool yet),
**`@cc/dsh-taskboard`** (the task ledger and the Tasks panel that replaces the subagent
catalog; `@cc/dsh-client-ui-subagent` is disabled so the header has one cell),
**`@cc/dsh-project-state-panel`** (one panel over the generated projections, with
four modes that share a selection: business requirements, the task board, the design map and
tests/traceability; selecting a requirement filters the board and the tests, a test shows its
requirement and evidence, a map node shows the requirements traced to its component, and the
map is designmap's own React Flow renderer; its only write is the owner changing a task
status — the panel sends the taskboard's `owner-status` op, the board mirrors the TASK and
records the override in the state journal, and the panel writes no file),
**`@cc/dsh-analysis`** (analysis before decomposition: one repo-tracked Analysis Record per
initiative with a completeness checker and impact analysis; `delegate_task` refuses L1/L2
without a ready record and `analysis_stale` after an affected change, while an L0 local fix
needs no document — the record is the only trace store),
**`@cc/dsh-orchestrator`** (root and child policy sections plus the root-only
`delegate_task` tool: it lists the workspace's roles in the root policy, refuses a
near-duplicate new role unless `forceRole` is passed, attaches to an existing task when
`taskId` is given, and carries a re-created role's earlier results into its brief),
**`@cc/dsh-papers`** (arXiv/Hugging Face paper search, HF daily trending, and a PDF
download with text extraction),
**`@cc/dsh-outline`** (the `outline` tool: the symbols and line ranges of a source file
instead of the whole file, so an unknown file costs a fraction of its bytes and you then
`read` only the range you picked; mounted on the host, so the root and every preset get it,
and it says `outline unavailable` when `code-skeleton-mcp` is absent).
`plugins/inventory.json` is the single source of truth for that set;
`scripts/check-portability.mjs` fails when a tarball, a mounted profile row, a
source directory or a packing entry point disagrees with it. The harness version
is pinned; sessions and workspaces stay machine-local by design.

The harness owns the persona, the request pipeline and the user interface; this kit adds a
deployment policy on top: the orchestrator's root/child sections, twenty runtime skills and a
flash-route guard. A repository's `AGENTS.md`/`CLAUDE.md` still reaches the model through
the harness's own loader. The Tasks panel is the one new primary surface: open it from the
sidebar, or from the **Tasks** header cell in a conversation. Its detail pane is
hideable; Pause/Resume, **Stop child**, Close and Remove act on the task, and
Pause/Close/Stop interrupt linked child sessions. The orchestrator has the same authority:
`task_cancel`, `task_pause` and `task_close` stop every linked child before changing the
task, and `task_stop` force-stops a task's children (or one `sessionId`) without changing the
status. Both of you can stop a subagent; the task only moves when the stop succeeds. **The lifecycle is strict and the panel cannot talk its way around
it**: a task is `open`, `active`, `paused`, `in review`, `done`, `blocked` or `cancelled`.
Moving one from Open to Active needs a specialist role with an owner or an `inline` task
(work you or the orchestrator does itself); moving it to Review needs a result summary and
at least one evidence item; Blocked needs the reason it waits on; and **Close** — the only
door to Done — is enabled only for a task in review, because a finished task is not an
accepted one; the orchestrator may supply the result in the same `task_close` call
(`resultSummary` plus at least one `resultEvidence`), which fills only fields the task does
not already have and never rewrites a recorded summary. `task_close` and `task_cancel` also
accept `ids` and do a batch in one ledger write, reporting each task separately. An illegal move is refused with a named code (`needs_role_or_inline`,
`needs_result`, `needs_evidence`, `needs_reason`, `needs_review`, `terminal`, `use_close`)
shown in the detail pane. The old `proposed` and `ready` columns meant the same thing and
are merged into Open: rows recorded before the merge still read as Open in the file's own
terms, and nothing rewrites them. The board has five columns (Open, Active, Review, Blocked,
Done) — a paused card sits under Active and a cancelled one under Done, with the chip still
naming the real state — and the List view is Status, **Role**, Task, Owner, Updated, where
the role chip carries the preset its child runs with and the child count. **Each chat has
its own board.** A new conversation starts with no
tasks, and the panel's **This chat / All chats** switch is the read of the workspace
history: All chats lists every task ever recorded here, marks rows from other chats as
`other chat`, and is the one place to clean up old rows. The roster above the board follows
this switch too: *This chat* counts only the roles linked to this chat's tasks, and *All
chats* is labelled **Workspace roles** and counts the whole registry. The model gets the
same two views
as `task_list` (scope `chat` by default, `workspace` on request). Each workspace keeps
persistent specialist roles (UX/UI, BACKEND, RESEARCH, CONTEXT, REVIEWER, CRITIC, DOCS); a role's
child is reused across tasks and shows active/sleeping/paused state. **CONTEXT** is the context
gatherer: the orchestrator delegates "how does this actually work today?" to it and gets one
report with `file:line` citations, so the reading happens in the child's context instead of
filling the orchestrator's. The ledger lives in
`.dsh/taskboard.json` inside the workspace; it is ignored by git and survives a restart.

**`@cc/dsh-delegation-brief`** (root-only): `delegation_brief` renders the brief for an accepted REQ from the register — the requirement and its criteria verbatim, related decisions, the tests that must pass with commands, non-scope and the return format — and returns a `briefHash`; the same state gives the same bytes. `delegation_return` checks the worker's `{status, criteria:[{id,pass,evidence}], questions}` against that hash and refuses `brief_stale`/`return_unmapped`. Refusals: `cold_start_required`, `feature_required`, `criteria_missing`.

**Шаблон отчёта и глоссарий.** Корневой промпт задаёт статический шаблон отчёта (итог, цель, изменения, доказательства, решения, риски, дальше) и правило: новый термин сначала в `docs/TERMINOLOGY.md`. `make verify` прогоняет `scripts/check-glossary.mjs` — он падает, если термин шаблона не определён или шаблон исчез из промпта.

**Заполнение реестра.** Пустой `state/` наполняется командой `node scripts/state-migrate.mjs`:
записи анализа становятся REQ (одно требование — один REQ), задачи таскборда — TASK (с
`boardId`), кейсы — TEST (с `caseId` и `evidenceRefs` из сохранённых прогонов). Скрипт только
читает источники; повторный запуск ничего не создаёт и не меняет байты `state/`. Задачи без
`reqId`, записанные до требования требования, остаются без него — `verify()` показывает их как
`task_req_missing`, миграция не придумывает обоснование.

**Статусы, отставшие от доски.** `node scripts/state-migrate.mjs --sync-status` сверяет
существующие TASK с `.dsh/taskboard.json` по `boardId` и переносит заголовок и статус
(доска — источник для строки, которая называет свой `boardId`); ничего не создаёт, `updatedAt`
не двигает, повторный прогон ничего не меняет. Нужен, когда строку доски закрыли в другой
сессии или другим инструментом, а реестр об этом не узнал и продолжает показывать `active`.

**Конкретика уже записанных задач.** `node scripts/state-migrate.mjs --refresh-tasks`
дополняет СУЩЕСТВУЮЩИЕ TASK полями задачи из таскборда — рамками, вне рамок, критериями
приёмки, ролью/владельцем, сессиями исполнителей и итогом, не создавая ни одной новой
записи. Заголовок, статус и body не трогаются (их пишет следующая запись задачи), а
`updatedAt` сохраняется, чтобы панель не переставила все задачи на «сейчас». Повторный
запуск ничего не меняет. Без флага команда остаётся создать-только миграцией выше.

**Project rules (`@cc/dsh-project-rules`) are one cached prompt section, and they are yours alone.** Open **Rules** in the sidebar, edit `.dsh/rules.md` (gitignored) and press Save. The panel never writes while you type; Save calls `/project-rules`, which only writes the file. **No agent may change that file**: a write or edit aimed at it is refused with `rules_human_only`, and so is a shell command that names it - the models read the rules through their prompt section and never write them. That is a guardrail, not a jail (a shell command can spell a path in ways a guard cannot follow); the roles without a shell at all - orchestrator, research - are the hard version. The section re-reads it at the next turn boundary and keeps the previous text when the bytes are unchanged, so a draft or a mid-turn save cannot bust the model's prompt cache. An empty file adds no section.

**The design map (`@cc/dsh-design-map`) is one file the orchestrator and you edit.** `design.excalidraw` at the project root is a normal Excalidraw scene; open **Design map** in the sidebar to edit it in the real editor, or let the orchestrator update it with the `design_map` tool. The map has a visual vocabulary: a node's kind is its shape (rectangle = service, ellipse = datastore, diamond = decision, dashed rectangle = external system), a layer draws a titled band the node stands in, an arrow's label names the flow and the map has one title. Every label is a real bound text, so double-click a box or an arrow and type. The orchestrator sees a text preview of the real geometry plus a health verdict in every result, so it notices a clipped or overlapping map and repairs it with an explicit `layout`; an ordinary update never moves a box you dragged. The tool is registered for the **orchestrator preset only**: a delegated specialist never receives it, so a BACKEND or UX child cannot rewrite the system design it was asked to work inside. The panel saves through the host command, so your drags, renames and new boxes land in the same file the agent reads, stamped with a revision and an author. A map older than a day is marked **stale** in the panel and in the tool's read output, which is the cue to ask the orchestrator to refresh it. The file is plain JSON and can be committed with the project if you want the map to travel with the code.

**The designmap panel (`@cc/dsh-designmap`) is the M4 replacement for the design map above.** The project keeps a semantic `designmap/model.yaml` (nodes, edges, groups) and `designmap/views.yaml`; the host lays them out deterministically with ELK, merges your visual layer from `designmap/overlays.json`, lints, and the panel asks the host for `op:'views'` — the scenes RENDERED WITH your layer, never a client-side merge. Seven `designmap_*` tools are registered for the **orchestrator preset only**; your drags and colour changes go through `/designmap op:'overlay'` (which writes only `overlays.json`) and the panel then re-renders the view, so arrows and label plates follow the node. Arrows are bound to their nodes in the editor, which is what makes them follow the cursor during a drag; the stored route is always the host's. A drop that lands on another node is auto-placed into the nearest free spot with a message and Undo. The legend shows the type with the colour actually used (and marks `mixed` when one type carries several colours). **Labels** are renamed in the panel's `Labels` inspector: `op:'label'` writes the model through `apply` (an empty edge label is refused as `missing_edge_label`). Because a label is a model field, the canvas text stays locked — an editable label would swallow the drag on the middle of the node. SVG export is canonical; PNG export is optional and needs `rsvg-convert`, ImageMagick `convert` or `magick`, otherwise it refuses with `png_converter_missing`. The old Excalidraw panel (`@cc/dsh-design-map`) is disabled in the kit patch and kept on disk for rollback; the vision loop is deliberately not shipped. The host half ships pre-bundled, so `dsh web` installs the plugin from the tarball without touching the npm registry.

**The test-case library (`@cc/dsh-test-cases`) keeps what a role actually tested — and runs it.** Cases live in `docs/cases/` as one JSON file each. A role explores with its normal tools, reproduces the behaviour and then records the case: an automated case stores its test path, the exact run command and the thresholds it cares about (`p95 <= 250 ms`, axe violations `<= 0`, a golden hash). The **Run** button on a case detail executes that stored command and records the measurement — exit code, duration, the driver's metrics and its artifacts under `docs/cases/runs/` — so a verified case is a measurement, not a sentence. Repeated runs keep the median/p95 and label a mixed result **flaky**; a baseline can be seeded from a passing run and checked with a tolerance band. A case that cannot be automated stores its steps, expected outcome and the reason, and its manual verification is marked **reported**, never measured. The orchestrator sees only the intake subset plus the gate: it can record a requirement you state in chat and ask whether the linked automated cases are verified, but it cannot claim a verification it did not run — and the taskboard refuses to close a task while a linked automated case is not verified. Edits are compare-and-set with a revision and history, and a case is superseded or deprecated rather than deleted. When a recorded surface file changes or an automated test disappears, `case_drift` marks the case **stale** and degrades a missing test to documented-only with the reason.

**Who may change what.** Three workspace artefacts have an owner that is not "any agent":

| Artefact | Agent side | Your side |
|---|---|---|
| `design.excalidraw` (design map) | **orchestrator only** (`design_map` is not registered for a child preset) | **Design map** panel |
| `.dsh/rules.md` (project rules) | **nobody** - refused with `rules_human_only`, in write/edit and in a shell command naming the path | **Rules** panel |
| `.dsh/taskboard.json` (task ledger) | any agent, in its own chat; another chat's row is refused `other_chat` | the whole board, in the Tasks panel |

**Roles are presets, and a new chat starts as Orchestrator.** It designs the system, runs the
taskboard and delegates; it has **no shell**, so it cannot build, test or run anything, but it
does have `write`/`edit` and makes small, self-evident changes itself. Anything whose proof is a
command's output (build, test, lint, migration, scan) still goes to a child with a shell. When work needs code, research, review or docs it delegates to a child that
has that role's persona and tools — UX/UI, Backend, Research, Reviewer, Critic, Docs — chosen
from the preset picker in a new session. **Critic** is the adversary: give it the algorithm or
service and it tries to break it — realistic non-trivial inputs, boundaries, out-of-order
events, restarts — on a disposable copy in `/tmp`, then reports the smallest reproducible
failure (or what it tried and what stayed untested). It never fixes anything — its `write` and
`edit` tools are disabled at the preset, so a finding cannot become a patch; it keeps a shell
for fixtures, and a shell can still write, so the never-fix rule is a persona plus a tool
surface, not a jail. It never touches
production data, and it is not the same job as Reviewer (judges a diff) or UX/UI (tests an
interface). Pick **standard** when you want a chat that edits work
directly instead of delegating; that is the hands-on escape hatch, and it keeps every kit
tool. The rest of the kit's role-specific tools follow the same rule: `papers_*` only in
Research, `diagram` for the
Orchestrator and UX/UI.

**A delegated role is a `(name, preset)` pair, and the name keeps one preset.** `delegate_task`
refuses to start a child under a name that already runs a different tool set
(`preset_conflict` on the ledger, a named refusal before the child exists), so `AUDIT` — which
used to mean reviewer in one chat and critic in the next — is gone: ask for REVIEWER to judge a
change or CRITIC to attack a running behaviour. A role row written before presets existed is
marked *legacy*: its tasks stay on the board, the root policy lists the name under **Legacy
roles (history only — do not reuse)** instead of offering it, and new work must reuse one of the
seven. A child that ends in **error** parks its task in *blocked* with the stop reason, not in
*review*, so the panel never reports failed work as ready to accept. To repair a board written
before these rules, run `node scripts/taskboard-migrate.mjs --board <workspace>/.dsh/taskboard.json`
(dry run, prints counts) and add `--apply` to back it up and write it; the script is idempotent
and refuses to overwrite a board that changed while it ran.

Hindsight memory is the third-party add-on: its installer stages the runtime and a
companion skill, and this machine's config is enabled against a local daemon at
`127.0.0.1:18888` (native DeepSeek provider). The daemon is a separate process and is not
auto-started; see `rules/DEPLOYMENT.md` §1.1. Hindsight tools register at DSH boot, so a
fresh server/session is needed after changing the config.

---

## 1. Fresh machine setup

Requirements: **Node.js ≥ 24**, git, and network access to npm.

### Linux / macOS

```bash
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust
./install.sh          # node check → pinned dsh → web profile → plugins → procedure
```

### Windows (PowerShell)

```powershell
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer does five things (idempotent; re-running upgrades to the pin):
1. checks Node **>= 24.9.0** - major and minor, because the pinned harness declares
   `engines: node >= 24.9.0` and Node 24.0-24.8 passes a major-only check and then
   fails at the harness start,
2. `npm i -g @deepseek-ai/dsh@0.2.2-rc.3` (exact pin),
3. writes `$DSH_HOME/profiles/web/{package.json,cordis.patch.yml,pnpm-workspace.yaml}`
   from the kit's canonical copies and installs every `plugins/*.tgz` into the
   profile. A `cordis.patch.yml` that differs from the kit is kept, and a copy is
   written beside it as `cordis.patch.yml.bak-<stamp>`; both installers behave this way,
4. installs the operating procedure to `$DSH_HOME/DEPLOYMENT.md`,
5. installs the convergence wrapper (see §2.1).

`$DSH_HOME` = `~/.npm/dsh` (Linux) / `%USERPROFILE%\.npm\dsh` (Windows) —
override with the `DSH_HOME` env var if you prefer another location.

## 2. Startup

```bash
./start.sh                 # Linux: dsh web --port 3080 (PORT env to change)
.\start.ps1                # Windows
# or directly:
dsh web --port 3080
```

**Open the URL the command prints.** Since 0.1.5 the web app is fenced behind a
login token: the boot line reads `http://127.0.0.1:3080/?token=…`, and a bare
`http://127.0.0.1:3080/` answers *authentication required*. Keep that token URL
(or the cookie it sets) rather than an old bookmark.

First run: the GUI opens with an onboarding screen — **configure your API
credentials there** (each machine keeps its own keys in
`$DSH_HOME/.credentials.yaml`; do not sync that file).

### 2.1 Start from the kit so updates apply themselves

The harness composes a profile once, at boot: a plugin, a patch row or a harness
pin changed in the kit reaches a machine only after a restart. Each installer puts
a wrapper in `$DSH_HOME/bin` that makes every launch that restart:

```bash
dsh web --port 3080        # Linux: $DSH_HOME/bin/dsh converges the kit, then boots
```

```powershell
dsh web --port 3080        # Windows: $DSH_HOME\bin\dsh.ps1 checks the kit, offers the update
dsh.ps1 web --port 3080    # ...or call it explicitly if dsh still resolves to the npm shim
```

On Linux the wrapper runs `scripts/kit-update.mjs --apply --no-harness --no-tools
--keep-model-config` before the harness starts, when no `dsh web` server is
running, and logs to `$DSH_HOME/kit-boot.log`. On Windows it runs the same
convergence as a read-only `--check` first, prints the pending actions and asks
once before applying, so a surprise update never lands unseen. Neither wrapper
edits the profile patch under a live server. The Windows wrapper reports that dsh
is already running when nothing is pending, and with work pending offers to stop
the server, apply, and boot the new version (that restart ends its sessions); it
refuses outright when the wrapper is itself running inside a dsh web server. The
POSIX wrapper still skips with one line while a server runs. Put `$DSH_HOME\bin`
before the npm global directory in `PATH` for the Windows wrapper to win over
`dsh.cmd`. Two things it deliberately does not do: it does not touch
the pinned harness or the optional external binaries (run `kit-update --apply`
without the flags for that), and it preserves the machine's
`agent-default-model` row - provider, model and reasoning effort are a cost
decision, not a kit artefact. `DSH_KIT_BOOT=0 dsh web` opts out for one launch.

`npx @deepseek-ai/dsh web` runs the package's own bin and cannot be intercepted by
the wrapper; use `dsh web` (or the explicit steps below) when you want the
convergence.

```bash
# any machine — check and apply in one line, then boot
node /path/to/dsh-kit/scripts/kit-update.mjs --check --fetch --json   # drift report
node /path/to/dsh-kit/scripts/kit-update.mjs --apply                  # converge
dsh web --port 3080
```

A small machine-local launcher wraps those three steps, so one command is both
"update if needed" and "start": it runs the check, prints the concrete pending
actions (harness / profile / plugins / procedure), asks once before applying, and
then boots and prints the token URL. Keep the launcher **outside** this
repository, next to `$DSH_HOME`, because it holds a machine-specific kit path
that must not be synced to the other machines.

On Windows that launcher is `$DSH_HOME/dsh-web.ps1`:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.dsh\dsh-web.ps1"
# flags: -Port 3080 -NoFetch -Yes -CheckOnly -NoStart -KitPath <dir>
```

It records what it converged to in `$DSH_HOME/.dsh-kit-state.json`, and treats a
non-interactive host (a service, a scheduled task) as "report the update, do not
apply it unseen" — pass `-Yes` to apply without a prompt in those contexts.

## 3. First-run checks (1 minute)

1. Open any workspace/session; the chat renders and the right sidebar exposes
   the upstream **Files** tree and document/preview tabs.
2. Ask the agent to run a shell command — upstream's terminal tooling keeps
   interactive sessions alive between tool calls, and command output renders as
   a terminal block in the chat.
3. Ask the agent to edit a file and confirm the change appears in the sidebar
   preview.
4. Ask for a `diagram`: it writes a standalone `.html` file in the
   workspace that the sidebar document preview renders.
5. Run `make provision`: every row must say `ok`, including the role toolchain
   (`depcruise`, `semgrep`, `oasdiff`, `difft`, `betterleaks`, `osv-scanner`, `lychee`,
   `trafilatura`, `browser-audit`). The orchestrator and research presets have no shell, so
   they cannot run those binaries themselves — their personas name the capability and delegate.

If it fails with `MISSING_CREDENTIAL`, finish the onboarding credential step. The static
half is one command — every plugin row must be mounted:

```bash
dsh --profile web --dump-config | grep -E "id: (notify|diagrams|subagent|godot-mcp)"
```

If a row is missing, the patch layer was overwritten — see §5.

## 3.1 Where the agent's rules come from

The harness's own workspace-instruction loader is used as shipped: it injects every
`AGENTS.md`/`CLAUDE.md` from the project root down to the working directory, framed as
guidance, and the most specific file wins. Put project instructions there.

There is no global prompt layer in this kit any more: no identity, persona, rule section or
machine-facts item is contributed to the system prompt, so nothing in the kit can be
diluted or overridden — there is nothing to overrule. The consequence is worth stating
plainly: **cost policy, remote-change permission and verification duties are no longer
part of the prompt.** They are yours to state in a repository's `AGENTS.md`, and they bind
only that repository.

## 3.2 Connecting Godot (the MCP server list)

`@cc/dsh-godot-mcp` gives the deployment a Godot editor the agent can drive:
scenes, nodes, scripts, signals and UI, through 47 tools published as
`mcp__godot__*`. It speaks no MCP itself — it keeps the **server list** and lets
the harness's own MCP client bridge do the connecting — and the list lives in the
kit, so any machine you converge has the server without you configuring it there.

`profile/mcp-servers.json` in the kit is the canonical list. `kit-update.mjs
--apply` projects it to `$DSH_HOME/mcp-servers.json` and then runs
`scripts/dsh-mcp-sync.mjs`, which writes the launch row the harness actually
loads into `$DSH_HOME/cordis.patch.yml`. Both steps are safe to re-run.

**When the editor is not running, the tools time out rather than failing fast.** The
MCP client bridge starts the bridge, the bridge cannot attach without a live editor,
and a call then waits for its own deadline before returning `Request timed out` — there
is no hint in that message. Two consequences, measured on 2026-10-26: an agent that
tries `mcp__godot__*` with no editor open loses a full timeout per call, and every
`dsh headless` run spawns the bridge (the row lives in the shared home layer), prints a
failing-attach traceback and carries on. Neither breaks a run; both cost time. Start the
editor, or ignore the Godot tools, until you need them.

Three pieces are **yours to supply**, because they are per-machine or per-project
content rather than kit configuration. The kit names the exact command instead of
pretending to have run it:

1. **The engine and the launcher.** Godot 4.7 or newer, and `uv` (which provides
   `uvx`, the launcher the Godot bridge is started through). `node
   scripts/provision-godot.mjs --mode apply` installs both, pinned and idempotent;
   `--mode check` reports state and writes nothing. It downloads **through Node**,
   because on some machines the OS TLS stack cannot reach the internet at all and
   every other installer fails there with `SEC_E_NO_CREDENTIALS` — measured again on
   Linux, where `curl` dies against the release hosts and Node's `fetch` does not.
   POSIX is verified; the Windows asset names and the `%USERPROFILE%\.local` layout are
   implemented from upstream's documentation and are **not verified here**, so treat a
   first Windows run as a test rather than as the POSIX result.
2. **The editor addon, committed into your Godot project**, at
   `addons/godot_ai/`, from the
   [Godot AI releases](https://github.com/hi-godot/godot-ai/releases). Commit it:
   that is what makes the connection travel with the project. Its **major version
   must match the `godot-ai==` pin** in `profile/mcp-servers.json`; a mismatch
   makes the bridge refuse the server rather than fail quietly.
3. **The plugin switched on** in Godot, once: **Project → Project Settings →
   Plugins → Godot AI**.

Then restart dsh — the launch row is read at boot. Ask the agent to confirm it
sees `mcp__godot__*` tools, and open the editor so there is a session to attach to.

Two limits, stated so a surprise is not a mystery. This server is
**editor-live**: it drives a running editor and can screenshot it, but it does not
attach to a running *game*. And a missing launcher costs you the Godot tools
**only** — every other feature still works, because the row is declared with
`failOnStartupError: false`; the sync output says the launcher is missing rather
than leaving you to guess.

If you ever configure this server from Godot's own AI dock instead, that dock
writes the same `$DSH_HOME/cordis.patch.yml`. The sync **refuses rather than
merges** when it finds entries it did not write, so you will get a named refusal
telling you which file to reconcile — not a silently deleted entry.

## 3.3 Usage analysis: one command

To see where the spend goes from a fresh platform export:

```bash
make usage
```

That is the whole procedure. It finds the newest `usage_data_*.zip` in your Downloads
folder, reads it (the ZIP is opened in Node; nothing is unzipped by hand), and writes
three reports into `reports/usage/`, named for the window the export covers:
`<from>_<to>.md`, `.json` and `.html`. It then **opens the HTML page in your browser**.
The HTML report is self-contained — inline CSS, no script, nothing fetched — so it
renders the same from disk, as an attachment, or in a document preview, with no network.

The published copy for that window is `docs/usage/2026-09.html` — a dated snapshot, whose
wording describes the model line-up as it stood then. To refresh that one
instead, point the reports at it:

```bash
node scripts/usage-analytics.mjs --export ~/Downloads/usage_data_2026-09.zip --out-dir docs/usage
```

In a script or on a headless machine, suppress the launch:

```bash
make usage NO_OPEN=1
```

**`make` is not required** — every target is a thin alias for the `node` command under it,
and `make` is not installed by default on Windows:

```bash
node scripts/usage-analytics.mjs                       # newest export in this machine's Downloads
node scripts/usage-analytics.mjs --export /path/usage.zip
node scripts/usage-analytics.mjs --export-dir /some/dir
node scripts/usage-analytics.mjs --no-agent-hours      # skip the session-log pass
node scripts/usage-analytics.mjs --check               # the redaction gate: write nothing, exit 1 on a leak
```

The download folder is resolved per platform: `%USERPROFILE%\Downloads` on Windows and
`$XDG_DOWNLOAD_DIR` (falling back to `~/Downloads`) on Linux. If several exports are
present the newest by modification time wins.

**Agent-hours.** The analysis divides spend by the hours agents were actually running,
not by calendar hours, which is why it also reads this machine's session logs under
`$DSH_HOME/sessions`. `--no-agent-hours` skips that pass and reports the token and cost
figures alone.

**The export files themselves are never committed.** They carry your account id,
partially masked API key strings and the names of the keys in use, and this repository is
public. So the reader drops those columns at the parse boundary, maps each key NAME to an
opaque `use-case-N` label that the report may group by, and then **re-reads its own
output** — every format it would write — refusing to emit a report that still contains
key-shaped material, a UUID or a credential header. `make usage-check` (or `--check`) is
that refusal as a command: it exits 1 and names the finding, rather than writing a page
that leaks.


## 4. Per-machine configuration

| Item | Linux | Windows |
|---|---|---|
| Credentials | first-run onboarding | same |
| Startup script | `./start.sh` | `.\start.ps1` |
| Default model | whatever `$DSH_HOME/settings.yaml` names — no gate, no picker trimming | same |
| Shell tooling | upstream `terminal/` family | same |

## 5. Migrating an EXISTING machine

The live profile may still reference tarballs and prompt files this kit no longer ships
(the cost-policy, prompt-layer, project-context, specs-window and chat-bridge plugins, and
the `$DSH_HOME/specs` directory they read). Bring it to the shipped set:

```bash
cd "$DSH_HOME/profiles/web"
corepack pnpm remove @deepseek-ai/dsh-model-gate @cc/dsh-context @cc/dsh-specs \
  @cc/dsh-adr-panel @cc/dsh-chat-bridge
corepack pnpm add /path/to/dsh-kit/plugins/*.tgz
cp /path/to/dsh-kit/profile/cordis.patch.yml cordis.patch.yml
```

Then restart `dsh web` and open the token URL it prints. `$DSH_HOME/specs` and
`$DSH_HOME/MACHINE.md` are no longer read by anything; delete them at your convenience.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `http://127.0.0.1:3080/` says authentication required | Expected since 0.1.5 — reopen the `?token=` URL printed by `dsh web` |
| Agent fails `MISSING_CREDENTIAL` | Credentials not stored — finish onboarding / the Models page |
| `dsh web` won't start | port 3080 busy (`PORT=3081 ./start.sh`) or Node < 24.9.0 |
| A plugin row not active after a config edit | The row registers at boot — restart `dsh web` |
| Sessions from the old harness missing/odd after an upgrade | Session formats are not guaranteed across versions. The installation rollback (§4 of `DEPLOYMENT.md`) restores the profile patch and `mcp-servers.json` from `$DSH_HOME/.dsh-kit-backups/<stamp>` with `kit-update --restore <stamp>`; it does not restore sessions, so keep your own copy before a harness upgrade |
| **All chats disappeared and a new one cannot be created** (every session file is still in `$DSH_HOME/sessions`) | one log the OS refuses to read aborts the whole session listing — dsh treats it as fatal, the `workspace` service never activates, and the UI loses history *and* New Session. Run `make session-doctor` to name it, `node scripts/session-store.mjs ensure` to quarantine it (bytes kept, `README.txt` restores it), then restart. `./start.sh` now does this on every boot; `SESSION_STORE=0` skips it |

## 7. Upgrades (short version)

One-liner habit:

```bash
npm i -g "@deepseek-ai/dsh@<candidate>"             # 1. install candidate
node scripts/pack-plugin.mjs --dir plugins/notify   # 2. repack each plugin against it
node scripts/check-portability.mjs                  # 3. the checks must pass
# 4. repoint the live profile + restart the GUI (token URL) only once it composes
```

## Activating a newly added plugin on an already-installed machine

`install.sh` and `install.ps1` protect an existing profile: if your `$DSH_HOME/profiles/<name>/cordis.patch.yml` differs
from the kit's, it keeps yours, writes a timestamped copy beside it and warns instead of overwriting. That is deliberate — the live profile
holds machine-local configuration — but it means a plugin added to the kit after you installed does not
reach your profile automatically.

`scripts/kit-update.mjs --apply` is the supported way to pick one up: it writes the kit's patch layer,
installs every kit tarball with the pinned pnpm, and verifies the installed bytes against each tarball.
What it deliberately does **not** do is merge your own edits into the patch layer — it writes the kit's
copy, so keep machine-specific rows in a second patch file, not in `profiles/web/cordis.patch.yml`.

The manual equivalent, if you want to keep your own patch layer:

```bash
# 1. install the new tarball into your profile.
#    Use the pnpm major that installed the profile: the store layout is versioned
#    (v10 vs v11), and a mismatched pnpm fails with ERR_PNPM_UNEXPECTED_STORE.
#    install.sh installs with ${PNPM_VERSION} above, currently 11.7.0.
cd "$DSH_HOME/profiles/web" && corepack pnpm@11.7.0 add "${KIT_DIR}"/plugins/cc-dsh-notify-*.tgz

# 2. add the matching insert entry to your cordis.patch.yml, copying it from
#    ${KIT_DIR}/profile/cordis.patch.yml

# 3. reload the profile; the harness restarts
```

A plugin whose version did not change is **not** reinstalled: pnpm resolves a `file:` dependency by its
path string from the profile lockfile, so even a repacked tarball with new bytes is served from the old
snapshot. Bump the plugin's version before repacking, or the old bytes stay in the profile and the fix
appears not to work. `kit-update.mjs` drops the profile lockfile and prunes the store before re-adding,
then verifies the installed bytes against the tarball and warns when they differ — so a silent version
mistake becomes a visible warning, but the version bump is still what makes the update correct.

Check composition without booting the app:

```bash
dsh --profile web --dump-config | grep -A1 'notify'
```

A missing entry there means the plugin is installed but not wired.

## 7.1 Research-first: the new-file gate

`@cc/dsh-research-first` refuses to CREATE a file in a session that has read nothing
current. It observes `web_fetch`/`web_search` results and gates new-file writes; editing an
existing file is never blocked, because the code in front of you is the truth about itself.
The denial names the lookup to do; `research_waive` exists for a machine with no way to look,
and the reason is logged.

Web calls in this deployment fail transiently: retry two or three times before treating a source
as unreachable, and remember that only a lookup that returned real content unlocks the gate.

It is a new plugin row plus a new package, and this harness does not import a newly installed
plugin into an already running server on its own: `kit-update` writes the row and installs the
package, and the loader keeps the failed import until something re-evaluates that entry. A
restart always works, but it is not the only way — **toggle the row**:

```yaml
# 1. add this, wait a few seconds
- id: research-first
  disabled: true

# 2. replace it with the real row, wait, then test
- id: research-first
  config:
    mode: deny
```

Measured on 2026-10-26: with the toggle, the tool schema and the prompt section appeared on the
next turn with no restart. The restart is the fallback, not the requirement.

One defect found on the way there, worth knowing because it looked exactly like "the plugin is
not installed": the waiver tool was registered as a raw object, the registry rejected it, and
Cordis rolled back the WHOLE plugin — so the guard disappeared with it. A kit tool must be built
with `defineTool`, and anything registered after the guard is wrapped so a declaration mistake
can never take the enforcement down.

## 7.1a Measuring the outline saving

`node scripts/outline-bench.mjs` reports, for real kit sources, the full read versus `outline`,
`outline` + the median symbol body and `outline` + the largest symbol body, and marks generated
bundles where the outline is the file (no gain). `--find <file> <symbol>` runs the negative
control: the bytes and approximate tokens to find one function with and without an outline.
`node scripts/outline-audit.mjs` is the journal audit: `outline` calls per session and `read`
bytes in sessions with and without an outline (baseline zero until the plugin is installed).

## 7.2 The external binaries, provisioned

`install.sh` finishes by running `scripts/provision-tools.mjs --apply`, which installs what is
missing and never reinstalls what is present. Re-run any time:

```bash
make provision          # report only, offline-safe
make provision-apply    # install what is missing (no sudo)
node scripts/provision-tools.mjs --check --json   # machine-readable
SKIP_TOOLS=1 ./install.sh                          # skip the step entirely
```

| Tool | Needed by | Installed as |
|---|---|---|
| `rtk` | shell-output compression | `rtk-oss` installer (Apache-2.0 only, `RTK_EDITION`) |
| `code-skeleton-mcp` | `outline`: a cheap code outline for every agent | `npm -g code-skeleton-mcp@0.1.3` |
| `marp` | deck export → PDF/PPTX | `npm -g @marp-team/marp-cli` |
| `mmdc` | Mermaid source → SVG | `npm -g @mermaid-js/mermaid-cli` with no bundled Chromium; a puppeteer config pointing at your Chrome is written to `$DSH_HOME/mermaid-puppeteer.json` |
| `d2` | D2 source → SVG/PNG/PPTX | the latest release tarball into `~/.local/bin` |
| `chrome`, `ffmpeg` | PDF rendering, video | **detected only** — they are OS packages |
| `depcruise` | backend: architecture rules, cycles | `npm -g dependency-cruiser@18.7.2` |
| `semgrep` | backend: pattern-based static analysis | `uv tool install semgrep==1.185.0` |
| `oasdiff` | backend: OpenAPI breaking-change gate | release archive → `~/.local/bin` |
| `difft` | reviewer: syntax-aware structural diff | release archive → `~/.local/bin` |
| `betterleaks` | reviewer: secrets scan | release archive → `~/.local/bin` |
| `osv-scanner` | reviewer: dependency vulnerabilities | bare release binary → `~/.local/bin` |
| `lychee` | docs: link and anchor check | static musl release archive → `~/.local/bin` |
| `trafilatura` | web text extraction (shell-bearing roles) | `uv tool install trafilatura==2.3.1` |
| `@axe-core/playwright`, `pixelmatch` | UX: accessibility audit, screenshot diff | `npm --prefix <kit>/.tools` |
| `impeccable` | UI design audit (`make design-audit`), the `impeccable` DSH skill | `npm -g impeccable@4.9.2` + engine `@impeccable/cli-linux-x64@0.1.25` into `~/.impeccable/bin` (sha256-checked) + the skill from the pinned commit into `$DSH_HOME/skills/impeccable` |

Everything is optional: a missing tool degrades its feature with a message rather than failing a
run. That is also why the check exists — silence was indistinguishable from "not needed".

`make design-audit` is a separate target: it runs the provisioned impeccable engine over the kit's
UI sources and prints one JSON document (engine version, 62 rules, targets, findings). It is not
part of `make verify`, which stays offline. To run the engine offline after provisioning:
`~/.impeccable/bin/impeccable detect --list-rules` (62 lines) needs no network.

## 8. The outside tools (RTK, skill evolution)

Each is a decision, not a default; none is required for the harness to run.

| Addition | What it buys | Switch on | Switch off |
|---|---|---|---|
| `@cc/dsh-rtk` | Compresses oversized shell results (`git log/diff`, test runners, `rg`, `find`) before the model reads them | Install the binary: `RTK_EDITION=oss sh <(curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh)` | Nothing to stop; remove the row to disable, or uninstall the binary and the plugin says it is absent |
| `@cc/dsh-run-code-projection` | Turns a large tool result (`run_code`, `read`, `bash`, `web_fetch`, Hindsight pages, `task_list`) above 8 KiB into a banner + head + tail with the full text in `.dsh/spill/` inside the workspace, so the bulk stops riding every step | Already in the profile; `tools`, `minBytes`, `headBytes`, `tailBytes`, `minSavingRatio` and `spillDir` are config on the row | Remove the row, or set `enabled: false` — the spill files stay on disk |
| `@cc/dsh-skill-evolve` | Skills grow: write, version, dedupe and archive `SKILL.md` under `$DSH_HOME/skills` | Already in the profile — four tools appear (`skill_evolve`, `skill_inventory`, `skill_grow`, `skill_forget`) | Remove the row; the library files stay |

RTK does not rewrite commands (this harness cannot rewrite tool arguments at all), so the
compression happens on the way back. When a result was elided, the banner at the top of the
result says so; re-run the command unfiltered, or use `rtk recall <hash>` when a hash is
printed. Prefixing a command with the binary yourself still works and gives you the filtered
form directly:

```bash
~/.local/bin/rtk git status
```

Skills written by `skill_evolve` are ordinary files, and the harness's `skill-filesystem`
provider watches the directory — a new skill appears in a running session's catalog with no
restart (proven on 2026-10-26: a probe skill appeared in the live catalog and vanished again
after `skill_forget`). To share a library between machines, `git init` the directory and push
it; there is no server.
