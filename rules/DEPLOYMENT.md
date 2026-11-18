# DEPLOYMENT.md — operating this machine's DeepSeek Harness

This file is the procedure for setting up, starting, updating and verifying the
DeepSeek Harness deployment on a machine. It is written to be read by an AGENT that
was asked to do the work, and it is installed to `$DSH_HOME/DEPLOYMENT.md` by the
installers. The commands here are the ones that are checked: `scripts/check-documentation.mjs`
fails if a script this document names is missing, if a plugin it describes is not mounted,
if the harness pin below disagrees with the installers, if any other place the harness version
is written — `README.md`, `USERGUIDE.md` — quotes a different one, or if the clone URL
disagrees with `README.md`.

`$DSH_HOME` is `~/.npm/dsh` on Linux/macOS and `%USERPROFILE%\.npm\dsh` on Windows,
unless the `DSH_HOME` environment variable overrides it.

## 1. What this deployment is

The upstream harness plus 25 plugins, all pinned and installed from one kit repository:

| Piece | What it does |
|---|---|
| `@cc/dsh-notify` | raises a desktop notification when an agent finishes a turn and when it asks the user a question (`notify-send`, a PowerShell toast, or `osascript`); spawned detached, argv-only, never blocking |
| `@cc/dsh-image-window` | keeps only the newest N images in a session's request by offloading the one that falls out of the window as a new image arrives — a *tail* rewrite, so a caching provider re-bills the new batch instead of the whole context. It exists because the harness satisfies a route's image budget reactively: an adapter rejects the request, `@deepseek-ai/dsh-compaction-image-offload` removes the **oldest** occurrences and retries, and that head rewrite re-billed 1,783,829 of 2,260,222 fresh tokens in one measured session (2026-11-10, `session-1cb0708d`, kimi-coding, 532K context). The harness plugin stays mounted as the safety net for a single image larger than the whole byte budget. `keepImages: 1` by default; raise it when a task compares several images |
| `@cc/dsh-diagrams` | one tool, `diagram`, that renders a JSON diagram spec into a standalone HTML file whose SVG is inline: flow and state (flowcharts, algorithm illustrations), layered architecture, and sequence diagrams. The agent describes nodes and relationships and the plugin computes the geometry — layered ranking with cycle breaking, edge routing with detours, and label placement — in a dependency-free engine. The Sidebar document preview displays it, so the file the user prints is the file the agent wrote |
| `@cc/dsh-designmap` | **M4 redesign, replaces `@cc/dsh-design-map`** (whose loader row the kit patch now disables with `disabled: true`; its source, tarball and inventory row stay for rollback). Semantic `designmap/model.yaml` + `designmap/views.yaml` → zod-strict validation → ELK layered layout → overlay merge + GC → lint → `designmap/out/<viewId>.scene.json` + `index.json`. Seven `designmap_*` tools (status/scan/apply/render/lint/open/export) gated to the **orchestrator** preset by default; the read-only panel reads through `workspaceFiles` and writes only through `/designmap op:'overlay'`, which the host guards with a strict allow-list and lands in `designmap/overlays.json`. SVG export is canonical; PNG is optional and needs an external converter (`rsvg-convert`/ImageMagick) or refuses with `png_converter_missing`. Package packed by `scripts/pack-plugin.mjs --dir plugins/designmap`; the host half ships pre-bundled (`dist/`, with the pinned `elkjs`/`yaml`/`zod` inlined and no runtime `dependencies`), so installing the tarball needs no npm registry and a `dsh web` boot stays offline — with real dependencies the boot spent 1m22s in pnpm retries and could leave the profile with no plugin set. Installed and active in the live web profile (0.1.4) |
| `@cc/dsh-design-map` (0.2.0, retired) | one Excalidraw scene, `design.excalidraw` at the project root, that the **orchestrator** and the human both edit. The orchestrator gets `design_map` (read/write/upsert/remove over labelled boxes and arrows; missing positions are laid out for it) and the human opens **Design map** in the sidebar. The tool is registered per agent on `agent/created` and ONLY for the `orchestrator` preset: a specialist child has no `design_map`, and an unknown preset gets none either (an ownership boundary fails closed). The `/design-map` command is not gated - it is the human's panel path. The panel embeds the real MIT Excalidraw editor in an iframe `srcdoc` built from a vendored 3.4 MB frame (no CDN), reads the scene through `workspaceFiles` and saves through the `/design-map` command; every save is stamped with `rev`, `updatedAt` and `updatedBy` at the scene root, and a read returns `ageMs`/`stale` so the orchestrator knows when the map must be refreshed. One document, one revision counter, no second store |
| `@cc/dsh-test-cases` | the observed test-case library in `docs/cases/`, which now EXECUTES: twelve host tools (`case_record`, `case_update`, `case_verify`, `case_run`, `case_suite`, `case_gate`, `case_list`, `case_get`, `case_supersede`, `case_deprecate`, `case_remove`, `case_drift`) over one schema-validated JSON file per case. `case_run` invokes the STORED `runCommand` through `ctx.shell` when the host mounts it (sandbox, caps, timeout) and records the measurement: exit code, duration, `commandSha256`, `head`/`dirty`, the driver's `CASE_SUMMARY` metrics/hashes/artifacts under `docs/cases/runs/`, and the case's declared `checks` (`{metric, op, threshold}`; a missing metric FAILS; `baseline: true` is a ratchet seeded only from a passing run; `runs` keeps median/p95 and records a mixed outcome as `flaky`). A green run with no recorded red is a measurement, not a verification: the measured red is `case_run {mode:'red'}` with a driver negative control (`CASE_NEGATIVE_CONTROL` must exit non-zero), while `case_verify` is the manual report stamped `source:manual`. `case_suite` runs a filtered set and writes a report; `case_gate` and the `cases` service expose the verdict, and the taskboard refuses `task_close` with `cases_not_green` when a linked automated case is not verified. Compare-and-set on `revision` with `history`; `case_drift` rehashes recorded surface files and degrades a missing test, but only `verified`/`failing`/`flaky` can go `stale`. The `orchestrator` gets intake plus `case_gate`, the tester presets get all twelve, and a preset not listed gets all twelve. CLI: `node plugins/test-cases/bin/cases.mjs`, `make cases` |
| `@cc/dsh-analysis` | analysis before decomposition. One repo-tracked `docs/analysis/<initiative>.json` per initiative, written with compare-and-set `expectedRev` and temp-file + rename, carrying the business outcome **separate** from the requested solution, the process, BR/FR/NFR with acceptance, architecture and data ownership, contract impact, invariants, decisions, open questions, the design-map revision and a requirement → process → component → task → evidence trace. Four root-only tools (`analysis_read`, `analysis_upsert`, `analysis_check`, `analysis_impact`); the checker looks past JSON shape (missing acceptance, component/data ownership, contract impact, unresolved trace, proven-without-evidence, deferred-without-reason, design drift, a hand-edited fingerprint) and `analysis_impact` marks a mid-work change stale. `delegate_task` reads the service through `ctx.get('analysis')` rather than `inject`, so an absent row keeps legacy delegation: L0 passes without a record, L1/L2 are refused `analysis_required` without a ready one and `analysis_stale` after an affected change or a moved design map. A read-only preset (`RESEARCH`/`REVIEWER`/`CRITIC`) and a `taskId` attach with explicit `legacyAttach:true` are exempt (the role label never exempts a write-capable preset); a monotonic completion guard refuses `task_close` for the last outstanding task of a still-planned requirement or a proven task without evidence, fails closed on an unreadable record, and refuses `update_goal action:"complete"` while a linked `goalId`/`goalHistory` record is incomplete; batches are atomic; adding/removing a requirement, a process/architecture edit, a bare `designRef` bump or a hand edit (until `acceptHandEdit`) reopens or refuses the record. The trace lives only in the record; the taskboard schema and the design-map layout are unchanged |
| `@cc/dsh-project-rules` | one workspace file, `.dsh/rules.md` (gitignored), rendered as the single prompt section `project:rules` at order 12 on every agent and subagent. The **Rules** panel edits it - **the human only**: a `tools/pre-execute` guard refuses an agent's `write`/`edit` of the resolved path and a `bash`/`pwsh` command naming it, both with the code `rules_human_only`, while the panel's command path is untouched. Guardrail, not jail: a shell command can spell a path the string match cannot follow, so the boundary is enforced by the guard where it can be and by review where it cannot. Typing is local React state, Save writes the file atomically through `/project-rules`, and the save deliberately does not touch the in-memory section. Each agent re-reads the file only at its own `turn/start` and **keeps the previous string when the bytes are unchanged**; an empty file renders no section. That is what makes the editor cache-safe: a dirty draft, a keystroke or a save mid-turn cannot change the system prompt of the turn already in flight, and an untouched file cannot churn the prefix between turns |
| `@cc/dsh-work-modes` | **not mounted** since 2026-11-05. It refused a third concurrent `subagent` child per session (its default limit is 2, which was the cap an operator hit). The cap was removed deliberately; the package and its tarball stay in the kit and `plugins/inventory.json` records `mounted: false`, so re-enabling it is one profile row. The ceiling now comes from the harness pool: the `subagent` row in `profile/cordis.patch.yml` sets `maxActiveSubagents: 64` (the harness default is 8) and leaves `maxDepth` at 1 |
| `@cc/dsh-godot-mcp` | keeps the deployment's MCP server list declarative and transportable: owns the canonical spec, resolves the `uvx` launcher the Godot AI bridge needs and the Godot project it starts in, and reports per declared server whether its tools are loadable. It implements no MCP itself — the harness's shipped `@deepseek-ai/dsh-mcp-client` bridge does the connecting, and `scripts/dsh-mcp-sync.mjs` writes the row that bridge loads into `$DSH_HOME/cordis.patch.yml`. **Two rows mount for this server and their ids must differ**: the plugin's own row is `id: godot-mcp` (the kit's convention is that a plugin row's id is its function name), while the bridge row the sync writes is `id: mcp-client-<server id>`. One composition has ONE loader-id namespace and the harness refuses the whole tree on a duplicate — `dsh web` fails to start with `duplicate loader entry id: godot-mcp`, which is what happened when a server id was used as the row id. Do not "tidy" the generated id back to the bare server id; `scripts/check-portability.mjs` fails when a generated id spells an authored one |
| `@deepseek-ai/dsh-subagent` | the harness's subagent service, mounted with this profile's one setting: `maxActiveSubagents: 64` (harness default 8), `maxDepth` left at its default 1. It owns the concurrent-child pool, parent/child relationships and the capacity check that answers `ACTIVATION_LIMIT_REACHED`; `subagent`, `subagent_fork`, `workflow` and `delegate_task` all spawn through it. Raising the pool here is what makes removing `@cc/dsh-work-modes` a real removal rather than a move from a cap of 2 to a cap of 8. The volatile fields are also editable on Plugins → Subagent, but a value written in this profile patch takes precedence and a form write it would override is refused |
| `@cc/dsh-skills` | registers twenty runtime skills through `ctx.skills.register`: `ponytail` (test paragraph patched to the proof rule), `grill-me`/`grilling`, `clear-writing`, `explain-webpage`, `explain-diagram` (adapted to the local `diagram` tool), `ui-builder`, `proof-not-tests`, `literature-review`, and five added 2026-10-26: `tests-that-could-fail`, `visual-explanations`, `ui-testing`, `ui-design-system`, `research-first`; and six added 2026-11-09 for UX/UI testing: `canvas-test-bridge`, `property-based-domain-tests`, `visual-golden-tests`, `a11y-keyboard-audit`, `maestro-mobile-flows`, `test-run-observability`. The tarball is the source of truth; no `$DSH_HOME/skills` copy |
| `@cc/dsh-flash-guard` | one `agent/request` waterfall. A delegated child (`delegationDepth > 0` or a `parentSession` header) whose route is not in `allowedRoutes` is **refused** before dispatch — never rewritten, because dsh freezes the route before that hook and a mutated result throws inside the turn (`dsh-agent-loop`: "use agent.model.select() before step preparation"); on 0.2.1 the old rewrite still worked, so this is a deliberate behaviour change, and `onViolation: rewrite` is now reported and treated as `refuse`. `enforceRoot: false` keeps the human's own model choice; external ACP/SDK/Claude Code providers bypass the seam and are the stated residual. A second, stricter rule covers routes nobody may run: a `deniedModels` match (`*highspeed*`) is **refused for root and child alike**, because silently substituting another model is how a "never use this" rule holds while the expensive route was already paid for |
| `@deepseek-ai/dsh-llm-pi-ai` | the harness's multi-provider LLM adapter, mounted dormant and activated by this profile's `providers` map. One extra route runs here: `kimi-coding`, the Kimi Code subscription endpoint (OpenAI-compatible, `https://api.kimi.com/coding/v1`), with exactly **two** models — `k3.1-pro` for planning, design, review and orchestration, and `kimi-for-coding` (K2.8 Preview) as the workhorse that stands in during DeepSeek peak hours. Neither highspeed variant is listed: they cost two to three times the tokens for latency this work does not need, and `deniedModels` refuses them if anything names one. Context windows come from the endpoint's own `GET /v1/models`; the key is only the credential reference `KIMI_CODING_API_KEY`, resolved per request from `$DSH_HOME/.credentials.yaml`. The same `providers` map also names `openai-codex: {}`: the pi-ai catalog already describes that provider (`https://chatgpt.com/backend-api`, protocol `openai-codex-responses`, OAuth grant "OpenAI (ChatGPT Plus/Pro)", `isSubscription: true`), so a ChatGPT subscription signs in through Settings -> Models and the credential is stored as `llm-pi-ai/openai-codex`; no API key and no prepaid API credits are involved |
| `@deepseek-ai/dsh-tool-subagent/model-selection-settings` | the harness's own gate for a model-facing child route: `enabled: true` with exactly three routes (`deepseek-official/deepseek-flash`, `kimi-coding/k3.1-pro`, `kimi-coding/kimi-for-coding`). The `subagent` tool and the kit's `delegate_task` accept `provider`/`model` only for a route listed here, and the Plugins → Subagent page edits the same namespace. The list deliberately matches `flash-guard.allowedRoutes`; a route offered here and rewritten there would be a setting that lies to the operator |
| `@cc/dsh-research-first` | one `tools/pre-execute` gate plus a `tools/result` observer. A successful `web_fetch`/`web_search` marks the session researched; creating a file that does not exist yet without one is refused, with the denial naming the lookup and the escape hatch. `research_waive({reason})` unlocks the session for offline work and logs the reason. `mode: deny` by default, `warn` for a trial, `allowPaths` for generated trees. It gates file creation, not design decisions inside an edit — that stays with the review |
| `@cc/dsh-tool-families` | one `agent/created` listener: expands the row's per-preset ALLOW list against the tool names the agent can see and calls the registry's agent-scoped `tools.restrict` with the complement, so a family the row does not name (e.g. `mcp__playwright__*` for backend) leaves the request header. Explicit `deny`/`projectDeny` still subtract, and a `projectDeny` family is kept only where its marker (`project.godot` for `mcp__godot__*`) exists in the session cwd; `standard` and any preset without a row keep everything. Hindsight is root-only and read-only (D4); Playwright only ux. `tools.restrict()` masks GLOBAL tools only — a preset-scoped tool (`bash`, `analysis_*`, `delegate_task`) is outside the policy and stays in the header (D11) |
| `@cc/dsh-designmap`, `@cc/dsh-diagrams`, `@cc/dsh-papers`, `@cc/dsh-test-cases` | these five host plugins gate their tools by the preset IN FORCE: the resolver is the `toolFamilies.presetFor` service (projection → remembered `agent-preset/selected` → creation header, the last fallback), and the registration is deferred — on `agent/created` and again on the root `agent-preset/selected` event the previous set is disposed through the `tools.register` disposers before the new one is registered, so a seat chosen on a blank session is honoured before the first request header. A gate never throws: an exception in `agent/created` cancels the session creation. `analysis_*` and `delegate_task` stay gated by the root lineage, not by preset. |
| `@cc/dsh-proof-guard` | one `tools/pre-execute` waterfall on `write`/`edit`. A path matching the test conventions needs a `PROOF:` header (`Behavior:`, `Fails when:`, `Production path:`); a legacy file that already carries one is allowed. `mode: deny` is the default, `warn` the trial. Friction, not proof: a shell write and a fake header are outside it |
| `@cc/dsh-state-feed` | L1/L2 delivery of the project state. At `agent/created` of a ROOT session with `state/views/digest.md` it injects one user message (`digest.md`, `plan.yaml`, `snapshot.md`); at `agent/pre-step` of step 1 it injects one aggregated delta (≤ 1200 B) only when the sha256 of digest+board+snapshot changed, never twice in one turn. A delegated worker (depth > 0 / parentSession / origin subagent) and a workspace without `state/` get nothing. `agent.inject()` makes the message a journal `user/message` with `source.kind: state-feed`; it does not wake an idle driver and is lost on cancel. Tests: `node --test plugins/state-feed/test/*.test.mjs`. |
| `@cc/dsh-project-state` | the state core, published as `ccProjectState` (no model tool). It is the single writer of `state/`: REQ/DECISION/TASK/TEST markdown with YAML frontmatter, typed IDs allocated under `state/.lock`, links storing the sha256 of their target, CAS transitions (`revision_conflict` on a stale `expectedRevision`, nothing written), append-only `state/events.jsonl` with `replay()` comparing bytes, `snapshot()` and a read-only `verify()` (`frontmatter_invalid`, `link_broken`, `link_stale`, `req_criteria_missing`, `task_req_missing` unless chore+reason, `orphan`, `status_invalid`, `id_mismatch`, `id_duplicate`). Tests: `node --test plugins/project-state/test/*.test.mjs`. |
| `@cc/dsh-project-state-panel` | one **read-only** panel, four modes over one selection: business requirements, the task board, the design map and tests/traceability. It reads `state/views/index.json` for the link contract and `state/<kind>/<ID>.md` frontmatter only for title/criteria/body/command/revision — never the markdown projections. Selecting a requirement filters Board and Tests; a task shows its requirement and tests; a test shows its requirement and evidence references; a map node shows the requirements traced to its analysis `componentId`, and following one switches to Requirements. The map is designmap's exported `SceneCanvas` (React Flow, scene geometry untouched); the panel's own badge overlay is positioned from the scene's node coordinates. It executes no write command (designmap's read-only `views` op only) and has no create/close/run action. Client-only host row; package packed by `scripts/pack-plugin.mjs --dir plugins/project-state-panel`. |
| `scripts/state-migrate.mjs` | fills `state/` from `docs/analysis/*.json` (→ REQ), `.dsh/taskboard.json` (→ TASK) and `docs/cases/*.json` (→ TEST), then regenerates the projections. Read-only on the sources; idempotent by source key (`analysisRef`, `boardId`, `caseId`), so a second run creates nothing and leaves `state/` byte-identical (`--dry-run` reports the plan). A TASK without `reqId` stays without one and is reported as `task_req_missing`; no justification is invented. |
| `scripts/check-glossary.mjs` | FR14 gate in `make verify`: every heading of the report template in the root policy (Итог, Цель, Изменения, Доказательства, Решения, Риски, Дальше) must be defined in `docs/TERMINOLOGY.md`, and the template must still be present in `plugins/orchestrator/orchestrator.mjs`. Fails both when a new report section ships undefined and when the template and the check drift apart. |
| `scripts/outline-bench.mjs`, `scripts/outline-audit.mjs` | bench and journal audit for the outline saving: full read vs outline vs outline+symbol body on real kit sources (`--find` runs the find-one-function negative control), and per-session `outline` calls and `read` bytes with/without an outline. Not part of `make verify` (they read the machine and journals). |
| `make design-audit` | runs the pinned `impeccable` UI detector (npm `impeccable@4.9.2` launcher, engine `@impeccable/cli-linux-x64@0.1.25`, sha256 `f48aca43…` into `~/.impeccable/bin/impeccable`) over the kit UI sources (`plugins/designmap/client/*`, `plugins/project-state-panel/client.js`) and prints one JSON document. Separate from `make verify`: verify stays offline. The DSH skill is installed from the pinned commit `d41d986…` into `$DSH_HOME/skills/impeccable` (SKILL.md, reference/ 46 files, scripts/). |
| `scripts/schema-lint.mjs` | FR5 gate in `make verify`: statically measures the description bytes of every tool (43 tools over the kit plugins), sums them per preset from the tool-families allow rows, WARN above 600 B per description and RED above 1200 (preset sums WARN 45 000 / RED 90 000); RED exits 1. It caught `analysis_upsert` at 2885 B before the diet. |
| `scripts/waiver-proof.mjs` | FR8 proof (not a gate): every lifecycle refusal (`req_required`, `steps_incomplete`, `test_req_required`, `evidence_required`) is observed refusing, refusing `waiver_required` on a malformed waiver, and passing with `{reason, by:'human'}` plus its journal line; `decision_superseded` refuses a decision without a successor and a reason. 17 checks. |
| `@cc/dsh-delegation-brief` | root-only tools that render a delegation brief from the register and validate the return. `delegation_brief` returns deterministic bytes and `briefHash` over the accepted REQ (criteria verbatim with stable `REQ-…-Cnn` ids, related decisions, mandatory TESTs with commands, non-scope, return format); `delegation_return` rerenders and refuses `brief_stale` when the criteria changed and `return_unmapped` when a criterion is unknown/duplicated/omitted. Refusals: `cold_start_required` (no core or no `state/views/index.json`), `feature_required` (REQ missing or not accepted), `criteria_missing`. Registers a short static prompt section for the root preset only. Tests: `node --test plugins/delegation-brief/test/*.test.mjs`. |
| `@cc/dsh-taskboard` | the workspace task ledger and the Tasks panel. One `.dsh/taskboard.json` per workspace holds objective, scope, non-scope, acceptance, status, owner, results and a timeline; `task_create`/`task_get`/`task_list`/`task_update` (CAS)/`task_note`/`task_link` share one Host service with the `/taskboard` command. The client half reads through `workspaceFiles`, writes through `commands`, registers `main` key `tasks`, the `sidebar.panellist` entry and the `subagent-catalog` header cell. It replaces the subagent catalog; `@deepseek-ai/dsh-client-ui-subagent` is disabled in the profile so the header has one cell, and child sessions open from the task detail. Pause/Resume, **Stop child**, Close and Remove are lifecycle actions: pause/cancel/close interrupt linked children through `ctx.subagents` (the hook passes the runtime's tagged `{kind:'ancestor',agent}` or `{kind:'user',parentSessionId}` authority, so the orchestrator and the owner both can stop a child; a refused interrupt fails closed), `task_stop` force-stops a task's children or one session without changing the status, close marks done (with an optional result in the same call) and interrupts, remove deletes the ledger row and leaves children running. Each workspace keeps persistent `agents[]` roles (one child per role), and each linked child records the role plus active/sleeping/paused state for the panel roster. **A chat has its own board**: every task records `chatId`, the root session of the lineage that created it, so a delegated child's task lands on the parent chat's board; reads default to the caller's chat and `task_list` scope `workspace` (or the panel's All chats toggle) reads the whole history. A chatless row (written before `chatId`) is visible only in the workspace scope and writable only by the human; an agent write from another chat is refused with `other_chat` |
| `@cc/dsh-orchestrator` | root-only policy section (`deployment:orchestrator-policy`), child-only section (`deployment:specialist-policy`) and a root-only `delegate_task` tool. The tool creates the task, renders a self-contained brief (objective, scope, non-scope, inputs, acceptance, output, proof, timebox), starts a child on the configured child route (flash by default) with `agentOptions`, and links the child id. `provider`/`model` are accepted only for a route enabled in Subagent model selection, so delegation can move to the Kimi workhorse when the default route is throttled; an unavailable route fails the call before the task row is written. The task is created before the child, so a failed start leaves a visible blocked task |
| `@cc/dsh-papers` | the paper-research tool family: `papers_search` (arXiv Atom + Hugging Face JSON, one source can fail while the other returns), `papers_trending` (HF daily papers) and `papers_download` (arXiv PDF into `.dsh/papers/`, capped at 30 MB, `pdftotext` when installed). No key; 20 s timeout with one retry; the literature-review skill calls these tools |
| `@deepseek-ai/dsh-client-ui-subagent` | shipped client package, **disabled** in this profile: its `subagent-catalog` header cell is replaced by the taskboard's Tasks trigger. Its right-pane child chat tab and `@` reference source are not mounted; child sessions open from the task detail. Re-enable it and use a fresh header id if the lineage popover is needed more than the one-cell replacement |

The harness owns the request pipeline and the user interface, but this kit now adds personas,
a role roster and a deployment policy on top of it. `@deepseek-ai/dsh-agent-preset` declarations
give each role its persona and its tool list; `@cc/dsh-orchestrator` registers a root policy
section and a child specialist section on `agent/created`; `@cc/dsh-skills` registers twenty
runtime skills; `@cc/dsh-flash-guard` refuses a delegated child's disallowed model route. The
earlier "no plugin contributes prompt text" stance is retired deliberately. A repository's
`AGENTS.md`/`CLAUDE.md` still reaches the model through the upstream loader; the deployment
policy is additional and scoped (root or child), not a replacement for the harness persona. The
model route is whatever the profile configures for the root agent; delegated children default to
flash and may be routed to one of the two allowed Kimi models, and external providers are
outside that seam.

**The retry policy is part of the model policy.** Both routes carry the same `retryPolicy`, and
it adds `MALFORMED_RESPONSE` to the harness defaults: an answer whose tool-call JSON does not
parse (`tool input is invalid JSON`) is retried up to five times per step instead of ending the
turn. The failure is raised at `message_stop` before any tool runs, so a retry re-sends the same
history and no partial answer reaches the model or the log; each attempt is another billed
request, which is why the budget stays bounded and the mode is `normal`, not `always`.

### 1.0 The role presets — tool sets, not prompts

Eight `@deepseek-ai/dsh-agent-preset` declarations sit in the profile patch, and
`@deepseek-ai/dsh-agent-preset-registry` defaults new sessions to it:
`preset-orchestrator`, `preset-ux`, `preset-backend`, `preset-research`, `preset-gatherer`,
`preset-reviewer`, `preset-critic`, `preset-docs`. A preset is the persona AND the tool list, so
the isolation is
registration, not a brief: the orchestrator reads and writes (`read`, `readImage`, `write`,
`edit`) but has no `bash` or `pwsh` at all - it can change a file and cannot run anything, so a
change whose acceptance is a command's output is delegated or handed to a role that owns the
binary; the research role has no shell and cannot surgically edit; the reviewer can run
and read, and its `write`/`edit` tools are disabled - but it HAS `tool-bash`, and **a shell
can write**: "cannot write" means "cannot use the write/edit tools", not "cannot change a
file". The same is true of the critic, whose `tool-fs` now carries `write: false` and
`edit: false` for the same reason (its persona says never fix). The backend, ux and docs roles
have the full shell and filesystem.

**`gatherer` is reconnaissance, and it exists to keep the root's context for the design.** The
orchestrator can read and write, but "how does this actually work today?" answered by the root's
own read/grep calls fills the window the design decision needs - and the next design step still
starts from a guess. `CONTEXT` is a child with `read`, `grep`, `glob` and a shell, and **no
`write` or `edit` tool**, so a report cannot turn into a patch; its persona requires `file:line`
citations, separates seen from inferred, and asks for one compact report instead of a transcript.
`ROOT_POLICY` states the rule: name the mechanism responsible before opening a task, and when the
understanding is missing, delegate one `CONTEXT` brief with the exact question and design from its
report - the tool calls stay in the child's context and are not replayed by the root. The same
read-only composition is what exempts it from the Analysis Record gate (`store.mjs` `readOnly`
set: `research`, `gatherer`, `reviewer`, `critic`), so reconnaissance never needs an L1/L2
document. Its `tool-families` row is an allow list of ten tools (read/glob/grep/bash/skill/
task_get/task_note/todo_write/working_directory/read_image): the gatherer reads code, it does
not drive an interface, and Playwright is not in its row.

**`critic` is the seventh child role, and it is a different job from `reviewer`.** The reviewer judges a
diff and does not write; the critic attacks a RUNNING behaviour - a service, a CLI, an
algorithm - with realistic non-trivial inputs and sequences, on a disposable copy (`/tmp`, a
scratch checkout, a copy of the data), and reports the smallest reproducible failure or what
it tried and what stayed untested. It never fixes and never touches production data, and its
preset carries no browser: UI crash testing stays with `ux`. `delegate_task` maps CRITIC,
CRITIC-GENERAL, TESTER and QA to `critic`, CONTEXT/GATHERER to `gatherer`, and REVIEWER/REVIEW to
`reviewer`. **AUDIT maps to
neither**: it was the one name that meant both jobs, and the ledger collapsed the two rows that
wore it (measured 2026-11-11 in `~/tasks/autolabel_pipeline`: `AUDIT [reviewer]` and
`AUDIT [critic]` became one row whose preset the second delegation silently overwrote).
`delegate_task` refuses AUDIT as a role name (with or without a preset) and answers with the
choice - REVIEWER to judge a change, CRITIC to attack a running behaviour.
`delegate_task` maps a role name to its preset and passes `agentPreset` in the start request; a
provider without `capabilities.agentPreset` is refused before a child exists, because the child
would silently inherit the orchestrator composition and the brief would promise work it cannot
do. Kit tools that only one role should see gate on the same recorded id through `agent/created`
plus `agent.ctx.tools.register`: `papers_*` to research,
`diagram` to the orchestrator and ux, and `design_map` to the **orchestrator
only**. `standard` stays in the picker as the
hands-on escape hatch, and a session with no recorded preset keeps every capability-gated tool,
so an unknown composition is never silently degraded - except `design_map`, which fails closed
because it is an ownership boundary, not a capability.

#### 1.0.0 Role identity is a `(name, preset)` pair

The taskboard's `agents[]` row is the record of a persistent specialist, and the pair is the
identity: `registerAgent` refuses to record a second preset under a name that already has one
(`preset_conflict`, the row untouched) unless the caller passes `force`, which is written into
the row's `history` as a deliberate re-composition. A row with **no** preset predates the
roster: it is marked `legacy` when read, it is never a reuse target (`delegate_task` refuses the
name without `forceRole`), and the root policy lists it under *Legacy roles (history only - do
not reuse)* instead of offering it for reuse. `scripts/taskboard-migrate.mjs` performs the
one-time repair on a board written before this contract: it splits `AUDIT` into
`REVIEWER`/`CRITIC` by the preset each row and task still records, marks preset-less rows
legacy, merges duplicate rows, and settles `active` tasks whose children have all ended. It is
idempotent, it copies the board into `.dsh/backups/` first, and it writes only if the file's
revision and bytes are unchanged since its own read (compare-and-set); a board that moved under
the run is refused with exit code 2 and no write. Usage:

```
node scripts/taskboard-migrate.mjs --board /path/to/.dsh/taskboard.json          # dry run, prints counts
node scripts/taskboard-migrate.mjs --board /path/to/.dsh/taskboard.json --apply  # backup + CAS write
```

#### 1.0.0.1 Host-wide tools are explicit, and measured

A preset is a plugin list, so anything the kit mounts at the HOST is inherited by every preset
and is not part of the role's composition. Two kinds exist, and they are worth naming because a
child's tool header looks far wider than its role:

| source | rows | what a specialist sees |
| --- | --- | --- |
| the eight presets | a per-preset plugin row set (persona, instructions, time, shell where allowed, fs, fs-search, jobs, skills, skill tool, compaction, todo, web, present) | its role's tool set |
| the host profile (`$DSH_HOME/cordis.patch.yml`, written by `scripts/dsh-mcp-sync.mjs`) | `mcp-client-godot-mcp` (`mcp__godot__*`), `mcp-client-playwright-mcp` (`mcp__playwright__*`), `hindsight` | inherited by every preset, including the reviewer |
| kit rows mounted at the host | taskboard, test-cases, skills, research-first, proof-guard, rtk, tool-families | inherited, but each gates its own role-only tools by `agent/preset` (`papers_*` research, `design_map` orchestrator, `diagram` orchestrator+ux) |

Measured 2026-11-11 from the root session's child headers: backend 105 tools, ux 107,
reviewer/critic/research 103, a legacy run-code-only role 1. The eight presets declare a per-preset plugin row set, so the difference is host-mounted, not role-granted. **The child policy now says
this in one line**, so a specialist knows an `mcp__*` tool in its header came from the host and
is not licence to do a job its role was given no tool for. Moving the MCP rows INTO the presets
is technically possible (a preset is a plugin list) but each mounted MCP row starts its own
server process per child session - a Chromium per UX child - so that placement is a cost
decision for whoever owns the MCP bridge, not a free tightening. The alternative, if the owner
wants the surface smaller, is to declare the row only in the presets that need it and disable
the root row; the kit-side plumbing is `profile/mcp-servers.json` plus
`scripts/dsh-mcp-sync.mjs`, both of which already build rows from a declaration.

**A child that ends in error parks its task in `blocked`, not `review`.** `review` means "the
runtime says the work finished"; a child that stopped with `stopReason: error` did not finish
it, so the row is blocked with that stop reason as its reason. `reconcile` (the service method,
and `applyOp {op: "reconcile"}` from the panel) settles the same way any `active` row whose
linked children are all settled - and never touches a row that still has a child `active` or
`paused`.

#### 1.0.1 Who may change what

Three workspaces artefacts have an owner that is not "any agent", and the deployment enforces
the boundary where it can:

| Artefact | Agent side | Human side | Enforced by |
|---|---|---|---|
| `design.excalidraw` (the design map) | **orchestrator only** - `design_map` is registered per agent for `agentPreset === 'orchestrator'`; a specialist child has no such tool | **yes** - **Design map** panel via `/design-map` | registration: a tool a child never received cannot be talked into existence by a brief. `standard`/unknown presets get no tool (fail closed). **This is registration-level, not a shell jail**: a role with `bash` can still edit `design.excalidraw` directly, exactly as it can edit `.dsh/rules.md`; the gate is which tools the role was given |
| `.dsh/rules.md` (project rules) | **nobody** - `write`/`edit` and `bash`/`pwsh` naming the file are refused with `rules_human_only` | **yes** - **Rules** panel via `/project-rules` | a `tools/pre-execute` guard on resolved paths and on the shell command text. A guardrail, not a jail: an obfuscated or symlinked path is outside it, and the panel command is a different registry so the human keeps the pen |
| `.dsh/taskboard.json` (the task ledger) | any agent in its own chat, through `task_create`/`task_update`/…; another chat's row is refused `other_chat` | **yes**, for the whole board | the taskboard service (chat scoping and the lifecycle invariants) |
| `docker`/MCP/network state | no role preset carries it; the harness's own tools decide | **yes** | the harness's tool registration |

The rule the human set: **the design map is edited by the orchestrator and the human; the
project rules are edited by the human alone.** Neither is offered to a child by any persona or
prompt section, and a child that reaches for one gets a named refusal it can quote.

**Never edit `$DSH_HOME/profiles/web/cordis.patch.yml` while `dsh web` is running.** The Loader
watches the profile layer and re-composes preset declarations on save: a live turn lost its
registered preset tools mid-session and the host was left half-mounted (measured 2026-11-10 —
every session then failed with `tools: at least one tool must have defer_loading=false`).
Change the kit's `profile/cordis.patch.yml`, then restart: `KIT_UPDATE=0 ./start.sh`, or
`./start.sh` to converge first.

**A plain `dsh web` converges too, since 2026-11-11.** The installer puts a wrapper at
`$DSH_HOME/bin/dsh` (canonical source `scripts/dsh-wrapper.sh`) after the nvm/npm PATH lines, so
it wins over the npm bin. Before the harness boots it runs
`scripts/kit-update.mjs --apply --no-harness --no-tools --keep-model-config`, logging to
`$DSH_HOME/kit-boot.log`. Three consequences worth knowing: (1) it skips with one line while a
`dsh web` server runs, which is exactly the rule above; (2) it preserves the machine's
`agent-default-model` row, so an automatic update cannot change provider/model/reasoning effort;
(3) it does not touch the harness pin or the optional external binaries — `node
scripts/kit-update.mjs --apply` (or `./start.sh`) remains the full convergence. `DSH_KIT_BOOT=0`
opts out for one launch, `DSH_KIT_DIR` relocates the kit. `npx @deepseek-ai/dsh web` runs the
package's bin directly and bypasses the wrapper; use `dsh web` when the convergence matters.

### 1.1 Hindsight memory — third-party, installed outside the kit

The only plugin that is deliberately not in this repository is Hindsight:

```bash
npx @vectorize-io/hindsight-coding-agents@0.8.2 install dsh
```

It stages its runtime under `~/.hindsight/coding-agents`, writes a `hindsight` row into
`$DSH_HOME/cordis.patch.yml` (the **home** layer, so every profile composes it), and writes
`~/.agents/skills/hindsight-coding-agent/SKILL.md`. Settings are read from
`~/.hindsight/coding-agent.json`; `serverMode` is `cloud`, `self-hosted` or `daemon`.

**The default is `daemon`: memory stays on this machine.** The installer asks once on a terminal
and defaults to `cloud` for a scripted run, so set it explicitly — and note that the package's own
`apiPort` default is 9077, so a config that wants 18888 must say so:

```json
{
  "serverMode": "daemon",
  "apiPort": 18888,
  "mapPathToBank": { "C:\\dsh-kit": "github::VanUST/dsh-vanust" },
  "retainTags": ["project:{gitProject}"],
  "retainMetadata": { "repo": "{gitProject}" }
}
```

**Cloud is opt-in and worse than nothing without a token.** Measured 2026-10-29: with
`serverMode: "cloud"` and no `apiToken`, every call answered
`401 {"detail":"Authentication failed: API key required"}`, and because a memory tool that throws
aborts the tool batch it belongs to, unrelated `web_fetch` calls in the same turn died with it.
Cloud is what shares one bank across machines; set `apiToken` at the same time or leave the daemon
in place.

The daemon is **not** started by the plugin (measured on 0.8.3: it talks to a daemon that is
already listening). It is started by a launcher that reads the DeepSeek key from DSH's credentials
at launch and never stores it, with the kit's own provider settings:

- Linux: unit `~/.config/systemd/user/hindsight-memory.service`, enabled at `default.target`,
  launcher `~/.hindsight/start-coding-agent.sh`; `systemctl --user status|restart`.
- Windows: launcher `~/.hindsight/start-coding-agent.ps1` and a per-user `Run` value
  `DshHindsightDaemon` (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`). The Run key, not a
  scheduled task: registering an at-logon task needs elevation here (`Access is denied`), while
  the per-user Run value does not.
- Either way `HINDSIGHT_API_LLM_PROVIDER=deepseek`, `HINDSIGHT_API_LLM_MODEL=deepseek-chat`,
  `HINDSIGHT_API_PORT=18888`, and `uvx hindsight-embed` runs embedded PostgreSQL on 127.0.0.1.

Verify with `curl -s http://127.0.0.1:18888/health` →
`{"status":"healthy","database":"connected"}`, and prove it serves memory, not just health:
`PUT /v1/default/banks/<id>` then `POST /v1/default/banks/<id>/memories/recall` both answer 200.
The embedded server reports `api_version` at `GET /version` and advertises its feature set there;
do not assume the cloud's API surface — check.

Config is read when the host loads the plugin, so a mode change takes effect only after restarting
`dsh web`. `hindsight_diagnose` reports the config file and the URL the live client is actually
using; when they disagree, the session is still on the old mode.

**Subagent tools need one pinned line, and the kit owns it.** `@vectorize-io/hindsight-coding-agents`
0.8.7 — still the latest published, and `main` as of 2026-11-13 — answers
`Hindsight memory is disabled for this workspace.` to every `hindsight_*` call from a subagent: the
tool bodies use the same subagent-excluding resolver its lifecycle hooks use, where an excluded
child session is deliberate (`origin === "subagent"`). The hooks must stay root-only — a second
automatic recall per delegation and a fragment retain of a conversation the parent already stores
is exactly what that guard prevents — but a CHILD that calls a memory tool is asking a question the
parent's own recall cannot answer for it. `scripts/hindsight-subagent-tools.mjs` applies the
one-line change (bind the caller's bank by `workspaceRoot(exec.agent)` in the tool body, nothing
else) and keeps a `.pre-subagent-tools` backup:

```bash
node scripts/hindsight-subagent-tools.mjs --check    # 0 patched | 3 unpatched
node scripts/hindsight-subagent-tools.mjs --apply    # idempotent; nothing else in the file changes
node scripts/hindsight-subagent-tools.mjs --probe    # drives the installed module as a subagent
```

`scripts/kit-update.mjs --apply` runs the check on every convergence and the apply when the plugin
is unpatched (`patch-hindsight-tools` in `kit.applied`), because a Hindsight reinstall overwrites the
file and silently takes the child tools away again. A new upstream release is the real fix: re-run
`--check`, and if it reports `unrecognized`, the line moved and the script must be updated rather
than forced.

**Refresh cadence is deliberately slower than upstream's default.** `pageRefreshEveryTurns` is 5 in
`~/.hindsight/coding-agent.json` (upstream defaults to 1, "every turn"). The setting bounds the
per-turn `listPages` call and the `<hindsight_page_refresh>` block that is appended when the roster
changes; the first-turn `<hindsight_pages>` preamble and the tool guide are unaffected, and the
plugin already skips an unchanged block, so the visible repetition is small either way. Measured on
this deployment's root session of 2026-11-13: 73 steps produced 3 injections (one 12,455-character
preamble plus two 3,542-character refreshes), which is why a cadence change is a cost trim and not a
behaviour fix.

**One bank per GitHub repository, shared across machines.** The bank a session writes to is
`bankIdTemplate`, and its placeholders are `{gitProject}`, `{project}`, `{harness}`, `{channel}`
and `{user}` — there is **no GitHub placeholder**, because the plugin resolves git locally and
never reads a remote URL. Device-independence therefore comes from the bank NAME, not from
discovery: map each clone's path to the literal `github::<owner>/<repo>` the clone belongs to,
and the same repository on any machine lands in the same bank:

```json
{
  "serverMode": "cloud",
  "apiUrl": "https://api.hindsight.vectorize.io",
  "mapPathToBank": { "C:\\dsh-kit": "github::VanUST/dsh-vanust" },
  "retainTags": ["project:{gitProject}"],
  "retainMetadata": { "repo": "{gitProject}" }
}
```

`mapPathToBank` holds a per-machine path; the bank name is the shared half, so every device adds
its own path mapping to the same literal. Without a mapping the default `{gitProject}` (the clone's
directory name) applies, which still shares memory between devices that clone into the same
directory name but not between a directory that was renamed. Resolve and check it with
`node ~/.hindsight/coding-agents/dist/status.js --repo <path>`; `hindsight_diagnose` reports the
bank a live session is actually using.

**Cross-device memory needs `serverMode: "cloud"` and an `apiToken`** — the token is the human's
step, obtained from Hindsight Cloud, and belongs in that file (or `HINDSIGHT_API_TOKEN`).
`daemon` is per-machine by design: it keeps memory on one device and is not a substitute for the
cloud bank. `self-hosted` points `apiUrl` at a Hindsight server you run, which shares memory across
whatever devices can reach it.

The installer appends its row as a YAML block after the home patch's JSON array. The
kit's `scripts/dsh-mcp-sync.mjs` (run by `kit-update --apply`) now lifts that block, writes
the row as JSON and preserves it; if a boot lands between install and sync, repair with
`node scripts/dsh-mcp-sync.mjs --apply`.

`kit-update` does not configure Hindsight, so the installed row survives a kit convergence. To remove it, delete the marked `HINDSIGHT_CODING_AGENTS_DSH_START` block from
`$DSH_HOME/cordis.patch.yml`; to disable it without uninstalling, add a profile/home patch
row `- id: hindsight disabled: true`.

Pinned harness version: **`0.2.2-rc.3`**. Node ≥ 24. The kit is the only source of the
deployment's own files; Hindsight is the documented third-party exception above, and a
machine is otherwise a projection of the kit.

### 1.2 The external tools, and how each is switched on

`scripts/provision-tools.mjs` installs these, and **convergence now runs it for you**:
`kit-update.mjs --apply` (which `install.sh`, `install.ps1` and both start scripts call)
provisions every missing tool as its last convergence step, so one command takes a fresh
machine from nothing to complete. Opt out with `kit-update --apply --no-tools` or
`SKIP_TOOLS=1`; report the state with `node scripts/provision-tools.mjs --check`, and install
by hand with `--only <ids>` / `--skip <ids>`. Missing tools remain a supported state — each
feature degrades and says so — which is exactly why they used to sit absent for weeks.

Nothing here needs elevation and nothing needs a POSIX shell. Where a tool has a release
archive it is downloaded and copied to a directory already on PATH (`%APPDATA%\npm` on
Windows, `~/.local/bin` elsewhere); where it is an npm package it is installed with the global
npm; the Python tools go through `uv tool install`, with `uv` itself installed on demand and
`~/.local/bin` added to the user PATH. Measured 2026-10-29 on Windows: `--check` went from
0/8 to 8/8 after `--apply`, and each binary answered `--version`.

**code-skeleton-mcp — the parser behind the `outline` tool (binary + plugin).** An npm
package (`0.1.3`, MIT) whose tree-sitter WebAssembly grammars (JavaScript, TypeScript, TSX,
Python, Go) are committed inside it, so it never fetches grammar bytes at run time and needs
no native build. Provisioning installs it with the global npm; by hand:

```bash
npm install -g code-skeleton-mcp@0.1.3
code-skeleton-mcp outline plugins/orchestrator/orchestrator.mjs --depth 1
```

`@cc/dsh-outline` is mounted on the HOST row, so the orchestrator and all seven presets get
the `outline` tool and its prompt section. The plugin resolves the binary from PATH (and a
configured `bin`), probes it with a real outline call, and registers nothing when the probe
fails: the section then says `outline unavailable` and where it looked. Measured 2026-11-17
on the installed 0.1.3: this repository's `plugins/orchestrator/orchestrator.mjs` is
83 148 B and its depth-1 outline 4 791 B (−94.2 %, ~0.4 s); depth 2 on
`plugins/analysis/store.mjs` returns 57 490 B against 8 924 B at depth 1, which is why the
default is 1. Languages: JavaScript, TypeScript, TSX and Python; Go reports types only. The
CLI has no `--version` (an unknown first argument starts its stdio MCP server), so the probe
is a real outline call; on a failure the CLI prints the reason to stderr and exits non-zero,
which the plugin reports as `EXIT`, and a zero exit with empty or non-JSON stdout is a named
failure too.

**RTK — shell-output compression (binary + plugin).** Installed by provisioning: the POSIX
path runs upstream's installer with `RTK_EDITION=oss`, and the Windows path downloads
`rtk-oss-x86_64-pc-windows-msvc.zip` from the same release, so both end up with the
Apache-2.0-only edition this kit uses. By hand:

```bash
RTK_EDITION=oss sh <(curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh)
rtk --version                 # must answer 'rtk <version>' — a different `rtk` exists on crates.io
```

`@cc/dsh-rtk` then resolves the binary from PATH, then `~/.local/bin/rtk`, then
`~/.cargo/bin/rtk` — never from a baked-in path — and reports the resolution in its prompt
section. With the binary absent the plugin is inert: it says so in the section and the
listener no-ops. There is nothing to start and nothing to stop.

What actually reaches the filter, measured on this machine (105 compressions between
2026-10-26 and 2026-11-05, dominated by `git-log` and `git-diff`): a listed command is
compressed when its output passes `minChars` (1500) and it is a single simple invocation. A
leading `cd <dir> &&` is stripped before classification, so `cd repo && git log --stat` is
compressed; a pipe, `;`, redirection, `git show`, `ls` or `cat` is passed through untouched —
rtk 1.1.0 ships no filter for those. The mapped rules now cover every `rtk pipe` filter name
this deployment can plausibly meet: git status/diff/log, pytest, cargo test, go test, go build,
ctest, tsc, vitest, grep, rg, find, fd, mypy, ruff check/format, prettier, phpunit, pest,
phpstan, pint, sqlfluff lint.

**The session store — one unreadable log costs the whole history (boot guard).** The other
failure that reads as data loss without any data being lost. `listArtifacts()` in
`dsh-session-persistence-jsonl` tolerates only `SessionFormatUnsupportedError` and
`SessionPersistenceCorruptionError` and rethrows everything else, and the `open()` inside
`readFirstZstdLine()` is not wrapped — so a single log the OS refuses aborts the **entire
cross-workspace listing**, the `workspace` plugin never activates, and the four plugins that
inject `workspaceRegistry` (`session-controller`, `workspace-controller`, `schedule`,
`ui-deliverables`) stay pending. `dsh web` then serves an empty history and cannot create a
chat. The local cause is an on-access security scanner returning `EPERM` for one file —
observed 2026-11-03 and again 2026-11-10, both times on a subagent log under
`tasks/Unnamed`; the boot log names it outright:

```
dsh: warning: 6 entries did not activate
workspace (@deepseek-ai/dsh-workspace): Error: EPERM: operation not permitted, open '…/session.v4.jsonl.zstd'
session-controller (@deepseek-ai/dsh-session-controller): pending (waiting for service: workspaceRegistry)
```

`scripts/session-store.mjs` owns the answer, and `start.sh` / `start.ps1` run `ensure` before
`exec dsh web`:

```bash
node scripts/session-store.mjs doctor   # report every log it would move; moves nothing, exits 1 when one is refused
node scripts/session-store.mjs ensure   # quarantine what the OS refuses, then exit 0 so the boot continues
node scripts/session-store.mjs ensure --verbose        # name every probed file
node scripts/session-store.mjs doctor --json           # machine-readable
SESSION_STORE=0 ./start.sh                             # skip the guard for one boot
```

`ensure` probes exactly what the harness does (`open` plus a first read), retries before it
decides, and moves **only** what stays refused — the whole session directory, bytes untouched,
into `$DSH_HOME/sessions-quarantine/<session>-<date>/`, with a `README.txt` naming the file,
the errno, the attempts and the restore command, plus one line per move in `preflight.log`.
It never moves a directory written in the last 60 minutes (`--max-age-minutes`), because a
fresh mtime means a live session. A clean store costs ~0.2 s and prints nothing; the summary
line is `make session-doctor`. Quarantining does not delete the chat: it removes it from the
listing, which is the difference between "invisible" and "gone".

**Run-code projection — the bulk of a `run_code` result, moved out of the step
(`@cc/dsh-run-code-projection`).** The tool that dominates this deployment's context is not bash
but `run_code`: measured over this workspace's session logs, `run_code` produced 33.3 MB of the
34.5 MB of tool output while `bash` produced 0.8 MB — which is why RTK, aimed at shell commands,
filters almost nothing here. On the same `tools/post-execute` seam RTK uses, a successful
`run_code` result above `minBytes` (8192) is replaced by a banner, the first `headBytes` (3072),
the last `tailBytes` (1536), the elided byte count, and the exact path of the full text written
inside the session workspace (`<cwd>/.dsh/spill/run_code-<callId>-<epoch>.txt`), so the middle is
one `read` away instead of on every subsequent request. It runs after `next()`, so another
policy's block or replacement stays authoritative, and it never touches errors, media, results
below the threshold, text that already carries its banner, or a session without a workspace. A
write failure logs once and returns the original result — the turn never sees an exception.
Measured with the shipped policy over the stored logs: 5.56% of all tool-result bytes saved
(87.6% of the `run_code` bytes it chose to project). Proof:
`node plugins/run-code-projection/proof/proof.mjs` — 13 checks, exit 0.

**PTC — the rollback, the upstream fix, and the first wave (`@deepseek-ai/dsh-tool-executor-ptc`).**
Under `mode: ptc` the model sees one `run_code` transport plus a generated SDK instead of every
tool schema, so several calls collapse into ONE step — and the step count, not the token price, is
what multiplies this deployment's bill (measured 2026-11-12: 40 880 steps over 183 sessions,
`$0.0021` each). It was enabled for `backend` and `research` and ROLLED BACK the same day, because
the switch is unsafe for a session that already exists:

1. A resumed session re-reads its preset, so its next request switches to PTC. The harness records
   that as a `developer/message` carrying `tool-addition: run_code` plus one `tool-removal` per
   previously announced tool (measured: 78 blocks in one message).
2. The provider projection marks every tool ADDITION as `deferLoading: true`
   (`dsh-llm/lib/index.js:763`, `toolDeclarations`) and the DeepSeek adapter forwards it as
   `defer_loading: true` (`dsh-llm-deepseek/lib/index.js:1729`).
3. When the added tool is the WHOLE new surface — which is exactly what a native→ptc switch is —
   the request carries only deferred tools and the provider rejects it:
   `INVALID_REQUEST: tools: at least one tool must have defer_loading=false. All tools cannot be
   deferred.` Every step of that session then fails.

A session CREATED under `ptc` was expected to be fine (its first header declares `run_code`, so it
is not an addition), but the long-lived role sessions were the unsafe case: the BACKEND role
session was created before the change, so resuming it failed on the first request.

**The upstream blocker is fixed in 0.2.2-rc.3, measured 2026-11-17.** The installed
`dsh-llm` rebuilds the declarations when the tool set changes by a removal or by additions to an
empty set (`rebaseAdditionOnlyHistory`), so the new surface is declared resident instead of all
deferred. Measured on a real native session resumed under PTC
(`session-40f5b5fd-ea0d-41a9-9237-3ab5324aa005`): the resumed request carried
`reason: resume` with the single tool `run_code`, a `developer/message` with one `tool-addition`
and 58 `tool-removal` blocks, the SDK in the system prompt, and no `INVALID_REQUEST`. The switch
still costs one full prefix miss (20 998 uncached tokens against 640 cached), so prefer a new chat
for the flip; a mid-session switch is accepted, not free.

**Waves 1–3 enabled: `gatherer`, `reviewer`, `backend`, `ux`, `critic`, `docs`.** Wave 1 (`preset-gatherer`,
`preset-reviewer`) went first because both are read-only over files (`write:false`,
`edit:false`), need no human input and have no plan mode; the gatherer is the purest "many reads →
one report" case, the reviewer runs a change and reads its diff as one program. Wave 2 added
`preset-backend` and `preset-ux` (rows at `profile/cordis.patch.yml:827` and `:752`, each after
`present`). Wave 3 added `preset-critic` and `preset-docs` (rows at `:1137` and `:1212`). Each
preset carries one `tool-executor-ptc` row inside its own declaration; the host still mounts the
native executor, the nearest executor for these six presets is PTC, and every other preset stays
native. `preset-orchestrator` and `preset-research` do NOT migrate: a PTC
program is a Node process, and its files, network and subprocesses are outside the file sandbox —
that would undo the no-shell contract those two roles are built on. No shell preset is left to
migrate. Rollback is removing the row from a preset: no data migration, no plugin change.

**Wave-2 measurements (2026-11-17).** Backend, fresh session: header `["run_code"]`, SDK 67
bindings with `bash`, 0 `mcp__playwright__*` and 0 `mcp__godot__*`; `node
scripts/outline-selftest.mjs` through `run_code` returned `verdict: PASS — 6 passed, 0 failed`.
A background command works through the program: `sleep 5` with `run_in_background: true` plus
`job_output` produced `job/registered` + `job/settled` and a `completed` answer after 5.3 s. Ux:
SDK 91 bindings with all 24 `mcp__playwright__*`, `browser_navigate` to
`data:text/html,<h1>PTCOK</h1>` and `browser_snapshot` returned `- heading "PTCOK" [level=1]`.
One `CODE_RUN_FAILED` was recorded on the first ux program: the browser cold start ran past the
120 s `run_code` limit; the retry did both calls in 209 ms. Price on one fixed task
(outline-selftest and its verdict): native backend 10 373 miss / 60 416 hit / 106 out = $0.00195;
PTC backend 27 330 / 34 048 / 201 = $0.00471. PTC is 2.4x the price on a ONE-tool-call task —
the SDK declarations lengthen the first step, and the saving only starts when a program makes
many calls.

**Wave-3 measurements (2026-11-17).** Fresh sessions, each with a preset chosen before the first
message, tool-families 0.1.8 in the overlay: gatherer header `["run_code"]`, SDK 59 bindings, 0
`mcp__playwright__*`, answer `24`; reviewer SDK 65, 0 playwright, `verdict: PASS — 6 passed, 0
failed`; critic SDK 65, 0 playwright, answer `42`; docs SDK 67, 0 playwright, the same PASS
verdict. `INVALID_REQUEST` and `CODE_RUN_FAILED` — 0 in all four. The gatherer/reviewer re-check is
the tool-families 0.1.8 proof: wave 1 could not show a deterministic 0 playwright in their SDK,
now it does. Price of the fixed outline-selftest task for docs: 18 161 miss / 43 520 hit / 232 out
= $0.00326, between native backend ($0.00195) and PTC backend ($0.00471) — the PTC-vs-PTC gap is
the prefix-cache state of the first step, not a property of the preset.

**`tool-families` 0.1.8: the preset is read from the projection, not the creation header.** The
policy used to read `agent.session.header.agentPreset` (the value the session was CREATED with)
and marked the agent done after one pass, so a session created under `orchestrator` and then
switched to `backend` kept the orchestrator policy and was offered all 24
`mcp__playwright__*` tools the backend row denies (measured: 91 tools on request 1). 0.1.8 reads
`agentPresets.presetForSession(session)`, keeps the applied policy in a `WeakMap` with its
disposer, and recomputes on every `agent/pre-step`. That alone is one request late: inside a step
the order is tools resolve → system prompt → `agent/pre-step`, so a restriction installed there
cannot reach that step's header. The early signal is the `agent-preset/selected` session event,
and it must be heard on the ROOT context (`ctx.root.on('session/event', …)`) — this row and the
`agentPresets` registry are siblings, and Cordis raises events upward, not sideways. With that,
the FIRST request after choosing `backend` is 67 tools with 0 `mcp__playwright__*`. The installed
profile still carries 0.1.5 until the next `kit-update --apply`; the scratch row proves 0.1.8.
Proof: `node scripts/tool-families-proof.mjs` (62/62), tarball
`plugins/cc-dsh-tool-families-0.1.8.tgz`.

**Restarting with PTC: what happens to an old session (measured 2026-11-17).**
A resumed session does not keep the preset generation it started with: `resumeObserved` composes
from the current declaration (`composeAgent(presetForObservation)` → `agentPresets.mount` of the
current generation). So an old native `preset-gatherer`/`preset-reviewer` session switches to PTC
on its first resume after the restart. Measured on :3081 with the same installed profile: header
83/89 tools → one `run_code`; `developer/message` with one `tool-addition` and 83/89
`tool-removal`; `INVALID_REQUEST`, `CODE_RUN_FAILED` and `defer_loading` all 0; the second answer
used the first; the first step paid 31 393 / 32 844 input tokens with 5 376 cached, the next step
went back to the cache (190 / 36 608). Dormant sessions are not switched until resumed.

Procedure for `:3080`: restart between turns (an active turn is interrupted and is not continued;
the session, its history and `.dsh/taskboard.json` survive). Stop the server, run
`node scripts/kit-update.mjs --apply`, start it, then resume the old sessions you still need
(Search sessions — the sidebar lists only the recent few) and send one continuation. The first
continuation pays one uncached step per session; do not resume sessions you do not need. If a
resumed session reports `INVALID_REQUEST: tools: at least one tool must have defer_loading=false`,
work in a new session of the same preset, or remove the executor rows from the kit profile, apply
and restart; do not edit the journal. A new chat avoids the one-time miss, but is not required:
the switch itself is accepted.

Do NOT set `DSH_TOOLS_MODE`, which flips the whole process. The shipped web-app bundle also offers
its own `ptc` preset (`id: ptc`, order 2) for experiments; it is untouched. Measure with a
disposable second server and fresh sessions, or on a new chat, never by flipping a preset that
existing sessions resume into without knowing the prefix cost.

**Skills that grow — `@cc/dsh-skill-evolve` (in the profile, nothing to start).** Writes
`<name>/SKILL.md` under `$DSH_HOME/skills`, which the harness's own `skill-filesystem`
provider already scans and hot-reloads. Skills written this way appear in a running
session's catalog without a restart. Keep the previous body in `.history/`, retreat to
`.archive/` for `skill_forget`, and never overwrite a hand-authored skill unless
`replace: true` is passed on purpose. Because the library is plain files, making it shared
between machines is `git init` in that directory — that is the "collective" half of
SkillClaw without a server.

**A description is a context budget, not documentation.** `MAX_DESCRIPTION` is 250
characters: the harness renders one description line per skill into the catalog that sits in
EVERY agent's system prefix on every request, so a paragraph there is paid by every role and
every step. Nine of the 70 skills had grown past it (max 323) on 2026-11-13; the frontmatter
description was trimmed and the bodies were not touched. A skill that needs more room says it
in the body — the catalog only has to route to it.

**Sharing that library across devices.** `git init` in `$DSH_HOME/skills`, commit the
`SKILL.md` files, add a remote, and clone it into `$DSH_HOME/skills` on every other machine: the
harness discovers whatever is on disk, so nothing else needs wiring. Keep `.history/` (previous
bodies) and `.archive/` (forgotten skills) out of the repository — they are local history, not
library content. The library is NOT scoped to a machine, so a skill must name its own platform
assumptions in the body: a procedure that lists `%APPDATA%` or PowerShell commands is wrong on
Linux, and a shared library that hides that fact teaches the next machine the wrong command.

**Marp, Mermaid CLI, D2 — deck export and diagram rendering (binaries only).** Provisioning
installs all three: the two npm CLIs (`marp`, `mmdc`) through the global npm, and d2 from its
release archive, whose name carries the project's own tokens — `d2-<tag>-<windows|macos|linux>-<amd64|arm64>.tar.gz`,
so `macos` (not `darwin`) and Windows archives are `.tar.gz`. Mermaid is installed with
`PUPPETEER_SKIP_DOWNLOAD=1` and then gets the pinned `chrome-headless-shell` that its own
puppeteer asks for (`puppeteer browsers install chrome-headless-shell` through that package's
CLI), plus `$DSH_HOME/mermaid-puppeteer.json` pinning `headless: "shell"` with extensions,
sync and first-run windows disabled. **Never point puppeteer at the installed desktop Chrome**
(`PUPPETEER_EXECUTABLE_PATH`): it makes the user's browser the machine-wide target of every
puppeteer consumer and can put real windows on screen, which no tool call may do. Measured
2026-10-29: a bare `mmdc -i x.mmd -o x.svg` exits 1 with "Could not find chrome-headless-shell
(ver. 156.0.8078.47)" until that revision is installed, and renders with no window afterwards.
Chrome and ffmpeg are DETECTED only, never installed: the probe looks on PATH and then in the
per-platform install locations (`%ProgramFiles%\Google\Chrome\Application\chrome.exe`,
`/Applications/…`), because neither Windows nor macOS puts a browser on PATH.

**Code search — Serena + Octocode, as a workspace pack per repository.** Two MCP servers give
agents symbolic navigation (Serena 2.1.0: `find_symbol`, `find_referencing_symbols`,
`get_symbols_overview`, plus `initial_instructions`, the connection manual its own prompt
demands) and conceptual/AST/graph retrieval (Octocode 0.29.2: `semantic_search`,
`structural_search`, `view_signatures`, `graphrag`). `profile/code-search-pack.mjs` adds one
static prompt section that routes between those instruments and the agent's own
grep/glob/read, and `profile/serena-hooks.json` mounts a Claude-Code-shape hooks bridge that
reminds an agent to use them. The spec is `profile/code-search.mcp.json`, deliberately **not**
a row in `profile/mcp-servers.json`: that list is projected into `$DSH_HOME/cordis.patch.yml`,
which serves every profile and every project, and a symbol server bound to one repository
(`--project-from-cwd`, `octocode mcp --path .`) must not appear in every project's sessions.
So the pack is generated as an overlay for ONE repository, and the harness home is never
opened for writing.

```bash
# Prerequisites. Serena also installs the `serena-hooks` command the hooks rows call; the
# bridge is a kit-local package. Expect 3/3 after provisioning.
node scripts/provision-tools.mjs --check --only serena,octocode,hooks-bridge
node scripts/provision-tools.mjs --apply --only serena,octocode,hooks-bridge

# Generate the overlay for the current checkout. `--project` is load-bearing: it becomes the
# bridge's cwd, which is where Serena and Octocode find the repository. `.dsh/` is gitignored.
node scripts/dsh-mcp-sync.mjs --spec profile/code-search.mcp.json \
  --project "$PWD" --out .dsh/code-search.patch.yml --apply

# Prove the rows compose before booting anything (no home-layer write, no server started).
DSH_KIT_BOOT=0 dsh --profile web --patch .dsh/code-search.patch.yml --dump-config \
  | grep -E 'mcp-client-(serena|octocode)|code-search-(routing|hooks)'

# Build the Octocode index for THIS revision, then gate it. The kit's config is required:
# it disables the 1.1 GB reranker and pins similarity_threshold = 0.3.
export OCTOCODE_CONFIG_PATH="$PWD/profile/octocode-config.toml"
octocode index
octocode stats                                  # Status: Up to date, HEAD matches
octocode index --list-files | sed -n 's/^  📄 //p' | sort > /tmp/indexed.txt
git ls-tree -r --name-only HEAD | sort > /tmp/head.txt
comm -13 /tmp/head.txt /tmp/indexed.txt          # absent from HEAD: must print nothing
while IFS= read -r p; do [ -e "$p" ] || echo "missing on disk: $p"; done < /tmp/indexed.txt
```

The overlay is **inert until an instance is started with it**: `dsh web --patch
.dsh/code-search.patch.yml --port 3080` (`dsh headless --patch …` for one run). `./start.sh`
forwards no extra arguments, so it cannot carry the pack — launch `dsh web` directly for a
packed instance. The servers, the routing section and the hooks are all read at boot: after
regenerating the overlay, or editing `profile/serena-context.yml`, `profile/octocode-config.toml`,
`profile/serena-hooks.json` or `profile/octocode-readonly-guard.mjs`, regenerate and restart.
There is no hot reload. The pack survives `kit-update` because it is not in the home layer,
but the overlay carries absolute paths and the kit owns the spec: regenerate it after moving
the checkout or after a kit update that changes the spec or a profile file.

**All roles, one surface.** The overlay inserts root-level loader rows, not a preset row, so
every role on that instance — orchestrator, backend, research, reviewer, critic, docs, ux and
standard — receives the same static routing section and the same `mcp__serena__*` /
`mcp__octocode__*` tools. No preset lists them, and a preset cannot hide them. Measured on a
standard headless session: 36 offered tools including all eight code-search tools
(`reports/code-search/integration.md`); per-preset lists were not read one by one, because a
root row is not per-preset state.

**Read-only is enforced, not requested.** Serena's `fixed_tools` is the whole surface: three
symbolic reads plus the manual, with no editing, memory, file-read or shell tools. Octocode
0.29.2 has no read-only switch, so `profile/octocode-readonly-guard.mjs` proxies its stdio
JSON-RPC: it deletes `rewrite` and `update_all` from `structural_search`'s advertised schema
and answers a call that still carries either with `-32601` before Octocode sees it. No LSP
tools are exposed (`mcp --with-lsp` is not passed). Neither server can write source; both
write tool state, which is why that state is outside the source tree or gitignored:
`<project>/.serena/` (Serena project config and symbol cache), `<project>/.dsh/serena-hooks/`
(hook counters) and `~/.local/share/octocode/<project-hash>/storage` (the index).

**Hooks run in a sandboxed HOME.** Hook processes run through the harness shell, whose HOME is
sandboxed per run, so `~/.serena` state was invisible to the next hook and the reminder never
accumulated (measured 2026-11-11: four real greps, all pass). `profile/serena-hooks.json`
therefore pins `SERENA_HOME=${CLAUDE_PROJECT_DIR}/.dsh/serena-hooks` on every hook.
`SessionStart` attaches the activation context and the manual, `PreToolUse` reminds and denies
after 3 consecutive grep calls, 3 code-file reads, or 4 mixed (120 s cool-down; a Serena
symbolic call resets the counter), and `Stop` cleans that session's state. In the measured runs
the bridge was invoked 64 times: 61 pass, 3 deny — one per task — and the retry after each
denial is part of the enhanced arm's latency.

**Indexing is a real setup step with a freshness trap.** Octocode's MCP server never indexes
(`mcp_index = false`); `octocode index` is the explicit step. The index is a snapshot of the
working tree, not of HEAD: untracked files are indexed, and generated `.serena/` state was
indexed in a measured run (138 files; 137 after removing it and re-indexing). So commit or
stash so the tree is clean, delete generated `.serena/` with the instance stopped, and let the
`comm` gate above prove every indexed path is in HEAD and on disk — this checkout's own
main-tree index failed that gate on 2026-11-11 with ten untracked paths. Cost measured here:
**10m32s and a ~10 MB store for 147 files**, one full index per revision; after HEAD moves,
`octocode stats` reports "Not indexed" until it runs again, and the MCP server will not
reindex mid-run. Serena regenerates `.serena/` on first use.

**Measured result: partial adoption, no efficiency claim.** In the clean paired run both arms
scored 1.0 on every task. Serena was used (8 calls: 3 `initial_instructions`, 5 `find_symbol`);
Octocode was offered but never called (0 calls). The enhanced arm made +20 requests, +25 tool
calls and +694,212 prompt tokens, with +31.2 s log wall; the instance also offered 11 more
tools (8 code-search, 3 MCP-resource) and 17,752 bytes of schema, plus the indexing cost
above. With one run per task that is descriptive, not causal, and it is not evidence that the
pack saves tokens or time. Evidence and the full tables:
[reports/code-search/report.md](../reports/code-search/report.md),
[adoption/comparison.json](../reports/code-search/adoption/comparison.json) and
[integration.md](../reports/code-search/integration.md) (local run artifacts; `reports/` is
gitignored, so these links exist in this checkout, not in an installed copy).

**The role toolchain — eight presets, nine pinned binaries, and two roles that cannot run them.**
Provisioning also installs the CLIs the role personas name. Each pin is the project's own latest
release measured on 2026-11-10; the release date, licence, last-commit date and the exact proof
command for every row are recorded in `.dsh/research/role-toolchain-install.md`.

| Binary | Pin (release) | Licence | Installed from | Proven with |
|---|---|---|---|---|
| `depcruise` (dependency-cruiser) | 18.7.2 (2026-11-02) | MIT | global npm | `depcruise --no-config --output-type text <dir>` |
| `semgrep` | 1.185.0 (2026-11-10) | LGPL-2.1 | `uv tool install semgrep==1.185.0` | a local rule reports `eval()` |
| `oasdiff` | 1.37.0 (2026-11-09) | Apache-2.0 | release archive, sha256 pinned | `oasdiff breaking` names a removed path |
| `difft` | 0.72.0 (2026-10-29) | MIT | release archive, sha256 pinned | `difft --check-only --exit-code` |
| `betterleaks` | 1.10.0 (2026-11-04) | MIT | release archive, sha256 pinned | `betterleaks dir` reports no leak |
| `osv-scanner` | 2.7.1 (2026-11-09) | Apache-2.0 | bare release binary, sha256 pinned | a lockfile scan reports lodash CVEs |
| `lychee` | 0.24.2 (2026-10-12) | MIT / Apache-2.0 | musl release archive, sha256 pinned | `lychee --offline` reports 1 OK |
| `trafilatura` | 2.3.1 | Apache-2.0 | `uv tool install trafilatura==2.3.1` | stdin HTML becomes clean markdown |
| `@axe-core/playwright`, `pixelmatch` | 4.14.0 / 8.0.0 | MPL-2.0 / ISC | `npm --prefix <kit>/.tools` | axe flags an unnamed button; pixelmatch counts one changed pixel |

Three facts the table cannot show. A downloaded artifact is verified before it is unpacked:
the digest is pinned in `scripts/provision-tools.mjs` where the kit measured it, and otherwise
read from the release's published checksum file; with neither, the install refuses. The GNU
`lychee` build needs GLIBC 2.39 while this kit runs on Ubuntu 22.04 (2.35), so provisioning
installs the static musl build — measured today, the GNU binary exited before printing a
version. And `~/.local/bin` is where the kit's binaries land, but a conda or distro copy of the
same name can sit earlier on PATH (measured: conda's `trafilatura` 2.0.0 beat the pinned 2.3.1),
so the probe prefers the kit's own `~/.local/bin/<name>` once it exists and `--check` reports
the pinned version rather than the ambient one. `--apply` never replaces a present binary; a
present-but-different version is reported as a note, so drift is visible without a silent
upgrade.

**Shell-less roles.** `preset-orchestrator` and `preset-research` have no `tool-bash`. They
cannot run any CLI in the table, and their personas say so: static analysis, scans, link
checks and extraction are capabilities they must request from a role that has bash. That is a
delegation, not a tool call, and the brief has to carry it.

**Two upstream rows the kit now pins, and why they are in the kit.** `profile/cordis.patch.yml`
carries `@deepseek-ai/dsh-client-ui-settings-general` (welcome notice suppressed at
`2026-09-28.1`) and `@deepseek-ai/dsh-agent-default-model` (`deepseek-official` /
`deepseek-flash` / `reasoningEffort: max`). Both lived only in the installed profile before
2026-10-26, which made `kit-update --check` report profile drift forever: the managed-seed rule
correctly refuses to overwrite a hand-edited patch, so the kit and the machine could never
converge. They are now kit state, because the deployment's model policy already assumed them
(`@cc/dsh-flash-guard` rewrites a child to flash and caps its effort at `high`; the root keeps
the human's choice). A machine that wants a different default edits these rows in the kit, not
in `$DSH_HOME`.

## 2. Fresh machine

```bash
git clone https://github.com/VanUST/dsh-vanust.git ~/dsh-kit
cd ~/dsh-kit
./install.sh                  # Windows: powershell -ExecutionPolicy Bypass -File install.ps1
./start.sh                    # Windows: .\start.ps1     (dsh web --port 3080)
```

`install.sh` / `install.ps1` are idempotent: Node check → pinned `npm i -g
@deepseek-ai/dsh@0.2.2-rc.3` → profile files under `$DSH_HOME/profiles/web` → every
`plugins/*.tgz` installed into that profile → `$DSH_HOME/DEPLOYMENT.md`.

Two steps in that list are the HUMAN's, not yours: entering API credentials (the
onboarding screen on first boot) and anything that touches another machine.

## 3. Update an installed machine

The kit is the source of truth; the machine record is `$DSH_HOME/.dsh-kit-state.json`,
and drift is decided by CONTENT HASH, never by version numbers or git state.

```bash
node "$KIT/scripts/kit-update.mjs" --check --fetch --json   # report drift, change nothing
node "$KIT/scripts/kit-update.mjs" --apply                  # converge, then record it
```

- `--check --fetch` asks git for new commits first; `--json` is the machine-readable form.
- `--apply` writes the canonical profile files and `DEPLOYMENT.md`, reinstalls every drifted
  plugin tarball with the pinned pnpm (dropping the profile lockfile and pruning the store
  first, because pnpm keys a `file:` dependency by its path string), installs the pinned
  harness when it differs, provisions every missing external binary (see §1.2), then records
  what it applied. `--no-harness` and `--no-tools` skip those last two steps.
- A machine that disagrees with the kit cannot look converged: `--check` exits non-zero
  and names the files.
- Restart `dsh web` afterwards — the profile is composed once, at boot. **A restart through
  `./start.sh` does NOT converge by itself:** with no interactive stdin it prints
  "no interactive stdin; booting without applying the kit update" and boots whatever the profile
  already holds, so a machine can be restarted any number of times with a fix sitting unapplied
  in the kit. Either answer `y` at its prompt, or run `node "$KIT/scripts/kit-update.mjs --apply"`
  explicitly (stopping the server first) and then start it. Proof that the right build is live:
  `node "$KIT/scripts/kit-update.mjs" --check --json` reports no drift.
- **Do not run `--apply` against a live server that is watching its own profile.** The web
  app reloads when the profile changes, and `--apply` changes the profile files FIRST and
  reinstalls the plugins afterwards, so a reload landing in between composes a half-applied
  state: the new patch against the old installed plugins. Stop the server, apply, start it
  again through the launcher — or apply and restart immediately, before trusting any session
  in it.
- **A restart kills every subagent running in a session, because they run inside the server
  process.** They are not lost — the session keeps them and a later message resumes one from
  where it stopped — but work in flight is gone and nothing re-runs it by itself. So: do not
  restart while a subagent is mid-task unless you are willing to re-run it, and after a restart
  PING each subagent you still need (`send_message`, or start a fresh one) before assuming its
  report is coming. Treat an unfinished subagent as an outstanding item, not as a silent
  failure.

`$KIT` is the clone's directory. If you do not know it, read it from
`$DSH_HOME/.dsh-kit-state.json` (`kit`), or ask: `node <kit>/scripts/kit-update.mjs --help`.

## 4. Checks you can still run

These check the kit's own source; the deployment does not need them.

```bash
node "$KIT/scripts/check-portability.mjs" # platform assumptions, packaging, plugin inventory
node "$KIT/scripts/check-documentation.mjs" # the pin, the named scripts and the plugin set
```

`make verify` runs both checks.

**There is no test suite, and none of the above is one.** The kit ships no automated tests:
a test about code the same agent just wrote restates that code's assumptions, passes because
it was written to pass, and becomes maintenance somebody else pays for. What replaces it is
running the product and reading what it produced — the commands above, a command's own output
and its exit code, the file it wrote. A test exists in this kit only when a human asks for one
as a verification or an evaluation, and then it is exactly what was asked for and nothing more.

There is no release gate and no law compiler. Treat a green check as evidence about that
check's own subject — never as a verdict on a change, and never as authorisation to touch a
live profile.

## 5. Rules you must not break while operating this

1. **The harness pin is exact.** Never `npm i -g @deepseek-ai/dsh` without a version. A
   harness upgrade rests on your own judgement and on the checks in section 4: install a
   candidate, run those checks against a checkout pinned to it, and only then converge a live
   profile.
   **Never replace the installed harness while a `dsh web` server runs** (a manual
   `npm i -g`, not only `kit-update`). The live process keeps the composition it composed at
   boot while serving the new files, so the next page load dies with `Failed to load plugins`:
   measured 2026-11-13, a 0.2.1-rc.2 process served a 0.2.2-rc.3 tree and `sidebar`/`chat`
   stayed pending on `contextMenus`/`fileDrag`, rows that only 0.2.2 adds. `kit-update`
   refuses a pin bump in that state (`harness.state action=blocked reason=web-server-running`);
   the manual path has no such guard, so stop the server first and restart it after.
2. **Bump a plugin's version before repacking it.** pnpm serves a `file:` dependency from
   the profile lockfile by path, so a repacked tarball with an unchanged filename does not
   land. The updater warns about it; the version bump is what makes it correct.
3. **Tarballs live in the kit repository.** Never install a plugin from a temporary path.
4. **Never commit machine-local state:** `$DSH_HOME/sessions`, `$DSH_HOME/storages`,
   `.credentials.yaml`, `settings.yaml`, `node_modules`.
5. **The kit's `profile/` files are canonical templates.** `kit-update.mjs` writes them
   over the machine's copies; machine-specific rows belong in a second patch file, not in
   `profiles/<name>/cordis.patch.yml`.
6. **Another machine is a remote system.** Reading it is fine; changing it needs the
   user's explicit permission for that exact action, every time.
7. **A prompt-affecting change is verified on a throwaway profile first** — a plugin row
   change or a harness bump is invisible in `--dump-config` beyond the row itself.
8. **A rule is real only where a command fails.** Before claiming something is enforced,
   name the command that exits non-zero when it is broken.

## 6. First-run checks (1 minute, human-visible)

```bash
dsh --profile web --dump-config | grep -E "id: (notify|diagrams|subagent|godot-mcp)"   # every row mounted
```

Then open the token URL `dsh web` printed, and confirm the chat renders, a shell command
runs, and a file edit appears in the sidebar. Ask an agent for a `diagram` — it must write a standalone `.html` file that the sidebar preview renders.
Two failures worth recognising: a missing plugin row means the patch layer was overwritten,
and an agent with no `mcp__godot__*` / `mcp__playwright__*` tools means the MCP rows were not
written — both are fixed by re-installing the profile files (§3).

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `http://127.0.0.1:3080/` says authentication required | expected: reopen the `?token=` URL the boot printed |
| `MISSING_CREDENTIAL` | credentials live per machine in `$DSH_HOME/.credentials.yaml`; finish onboarding |
| A plugin change had no effect | the profile composes at boot — restart `dsh web` |
| The UI shows no history and New Session does nothing, on a machine whose sessions are all on disk | one unreadable session log aborted the whole listing (scanner `EPERM`): `make session-doctor` names it, `node scripts/session-store.mjs ensure` quarantines it, then restart. `start.sh` does this on every boot |
| `dsh: warning: N entries did not activate` at boot | read the named rows: a plugin package that is not installed (`ERR_MODULE_NOT_FOUND`) is a stale patch row, a `pending (waiting for service: …)` chain starts at the first failed service |
| A subagent stopped mid-task with no report | the server restarted under it; ping it to resume (see §3) — it is not lost, and only its in-flight work is |
| A repacked tarball had no effect | its version was not bumped (§5.2) |
| A command you read here no longer exists | the kit moved on: `node $KIT/scripts/check-documentation.mjs` fails on a named script or plugin that is missing, so run it before trusting the prose |
| A non-Flash model is dispatched for a delegated child | `@cc/dsh-flash-guard` should rewrite or refuse it; check that the row is active and that the child is going through DSH's LLM. An external ACP/SDK/Claude Code provider bypasses `agent/request` by design. The root agent is deliberately not forced (`enforceRoot: false`) |
