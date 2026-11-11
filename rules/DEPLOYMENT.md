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

The upstream harness plus twelve plugins, all pinned and installed from one kit repository:

| Piece | What it does |
|---|---|
| `@cc/dsh-notify` | raises a desktop notification when an agent finishes a turn and when it asks the user a question (`notify-send`, a PowerShell toast, or `osascript`); spawned detached, argv-only, never blocking |
| `@cc/dsh-presentation` | one tool, `presentation`, that renders a JSON deck spec into a standalone HTML file in the workspace; the Sidebar document preview displays it, so the file the user previews is the file they export and print |
| `@cc/dsh-diagrams` | one tool, `diagram`, that renders a JSON diagram spec into a standalone HTML file whose SVG is inline: flow and state (flowcharts, algorithm illustrations), layered architecture, and sequence diagrams. The agent describes nodes and relationships and the plugin computes the geometry — layered ranking with cycle breaking, edge routing with detours, and label placement — in a dependency-free engine. The Sidebar document preview displays it, so the file the user prints is the file the agent wrote |
| `@cc/dsh-work-modes` | **not mounted** since 2026-11-05. It refused a third concurrent `subagent` child per session (its default limit is 2, which was the cap an operator hit). The cap was removed deliberately; the package and its tarball stay in the kit and `plugins/inventory.json` records `mounted: false`, so re-enabling it is one profile row. The ceiling now comes from the harness pool: the `subagent` row in `profile/cordis.patch.yml` sets `maxActiveSubagents: 64` (the harness default is 8) and leaves `maxDepth` at 1 |
| `@cc/dsh-godot-mcp` | keeps the deployment's MCP server list declarative and transportable: owns the canonical spec, resolves the `uvx` launcher the Godot AI bridge needs and the Godot project it starts in, and reports per declared server whether its tools are loadable. It implements no MCP itself — the harness's shipped `@deepseek-ai/dsh-mcp-client` bridge does the connecting, and `scripts/dsh-mcp-sync.mjs` writes the row that bridge loads into `$DSH_HOME/cordis.patch.yml`. **Two rows mount for this server and their ids must differ**: the plugin's own row is `id: godot-mcp` (the kit's convention is that a plugin row's id is its function name), while the bridge row the sync writes is `id: mcp-client-<server id>`. One composition has ONE loader-id namespace and the harness refuses the whole tree on a duplicate — `dsh web` fails to start with `duplicate loader entry id: godot-mcp`, which is what happened when a server id was used as the row id. Do not "tidy" the generated id back to the bare server id; `scripts/check-portability.mjs` fails when a generated id spells an authored one |
| `@deepseek-ai/dsh-subagent` | the harness's subagent service, mounted with this profile's one setting: `maxActiveSubagents: 64` (harness default 8), `maxDepth` left at its default 1. It owns the concurrent-child pool, parent/child relationships and the capacity check that answers `ACTIVATION_LIMIT_REACHED`; `subagent`, `subagent_fork`, `workflow` and `delegate_task` all spawn through it. Raising the pool here is what makes removing `@cc/dsh-work-modes` a real removal rather than a move from a cap of 2 to a cap of 8. The volatile fields are also editable on Plugins → Subagent, but a value written in this profile patch takes precedence and a form write it would override is refused |
| `@cc/dsh-skills` | registers twenty runtime skills through `ctx.skills.register`: `ponytail` (test paragraph patched to the proof rule), `grill-me`/`grilling`, `clear-writing`, `explain-webpage`, `explain-diagram` (adapted to the local `diagram` tool), `ui-builder`, `proof-not-tests`, `literature-review`, and five added 2026-10-26: `tests-that-could-fail`, `visual-explanations`, `ui-testing`, `ui-design-system`, `research-first`; and six added 2026-11-09 for UX/UI testing: `canvas-test-bridge`, `property-based-domain-tests`, `visual-golden-tests`, `a11y-keyboard-audit`, `maestro-mobile-flows`, `test-run-observability`. The tarball is the source of truth; no `$DSH_HOME/skills` copy |
| `@cc/dsh-flash-guard` | one `agent/request` waterfall. A delegated child (`delegationDepth > 0` or a `parentSession` header) whose route is not in `allowedRoutes` is rewritten to `deepseek-official/deepseek-flash` or refused before dispatch. `enforceRoot: false` keeps the human's own model choice; external ACP/SDK/Claude Code providers bypass the seam and are the stated residual. A second, stricter rule covers routes nobody may run: a `deniedModels` match (`*highspeed*`) is **refused for root and child alike**, because silently substituting another model is how a "never use this" rule holds while the expensive route was already paid for |
| `@deepseek-ai/dsh-llm-pi-ai` | the harness's multi-provider LLM adapter, mounted dormant and activated by this profile's `providers` map. One extra route runs here: `kimi-coding`, the Kimi Code subscription endpoint (OpenAI-compatible, `https://api.kimi.com/coding/v1`), with exactly **two** models — `k3.1-pro` for planning, design, review and orchestration, and `kimi-for-coding` (K2.8 Preview) as the workhorse that stands in during DeepSeek peak hours. Neither highspeed variant is listed: they cost two to three times the tokens for latency this work does not need, and `deniedModels` refuses them if anything names one. Context windows come from the endpoint's own `GET /v1/models`; the key is only the credential reference `KIMI_CODING_API_KEY`, resolved per request from `$DSH_HOME/.credentials.yaml` |
| `@deepseek-ai/dsh-tool-subagent/model-selection-settings` | the harness's own gate for a model-facing child route: `enabled: true` with exactly three routes (`deepseek-official/deepseek-flash`, `kimi-coding/k3.1-pro`, `kimi-coding/kimi-for-coding`). The `subagent` tool and the kit's `delegate_task` accept `provider`/`model` only for a route listed here, and the Plugins → Subagent page edits the same namespace. The list deliberately matches `flash-guard.allowedRoutes`; a route offered here and rewritten there would be a setting that lies to the operator |
| `@cc/dsh-research-first` | one `tools/pre-execute` gate plus a `tools/result` observer. A successful `web_fetch`/`web_search` marks the session researched; creating a file that does not exist yet without one is refused, with the denial naming the lookup and the escape hatch. `research_waive({reason})` unlocks the session for offline work and logs the reason. `mode: deny` by default, `warn` for a trial, `allowPaths` for generated trees. It gates file creation, not design decisions inside an edit — that stays with the review |
| `@cc/dsh-proof-guard` | one `tools/pre-execute` waterfall on `write`/`edit`. A path matching the test conventions needs a `PROOF:` header (`Behavior:`, `Fails when:`, `Production path:`); a legacy file that already carries one is allowed. `mode: deny` is the default, `warn` the trial. Friction, not proof: a shell write and a fake header are outside it |
| `@cc/dsh-taskboard` | the workspace task ledger and the Tasks panel. One `.dsh/taskboard.json` per workspace holds objective, scope, non-scope, acceptance, status, owner, results and a timeline; `task_create`/`task_get`/`task_list`/`task_update` (CAS)/`task_note`/`task_link` share one Host service with the `/taskboard` command. The client half reads through `workspaceFiles`, writes through `commands`, registers `main` key `tasks`, the `sidebar.panellist` entry and the `subagent-catalog` header cell. It replaces the subagent catalog; `@deepseek-ai/dsh-client-ui-subagent` is disabled in the profile so the header has one cell, and child sessions open from the task detail. Pause/Resume, Close and Remove are lifecycle actions: pause interrupts linked children through `ctx.subagents`, close marks done and interrupts, remove deletes the ledger row and leaves children running. Each workspace keeps persistent `agents[]` roles (one child per role), and each linked child records the role plus active/sleeping/paused state for the panel roster. **A chat has its own board**: every task records `chatId`, the root session of the lineage that created it, so a delegated child's task lands on the parent chat's board; reads default to the caller's chat and `task_list` scope `workspace` (or the panel's All chats toggle) reads the whole history. A chatless row (written before `chatId`) is visible only in the workspace scope and writable only by the human; an agent write from another chat is refused with `other_chat` |
| `@cc/dsh-orchestrator` | root-only policy section (`deployment:orchestrator-policy`), child-only section (`deployment:specialist-policy`) and a root-only `delegate_task` tool. The tool creates the task, renders a self-contained brief (objective, scope, non-scope, inputs, acceptance, output, proof, timebox), starts a child on the configured child route (flash by default) with `agentOptions`, and links the child id. `provider`/`model` are accepted only for a route enabled in Subagent model selection, so delegation can move to the Kimi workhorse when the default route is throttled; an unavailable route fails the call before the task row is written. The task is created before the child, so a failed start leaves a visible blocked task |
| `@cc/dsh-papers` | the paper-research tool family: `papers_search` (arXiv Atom + Hugging Face JSON, one source can fail while the other returns), `papers_trending` (HF daily papers) and `papers_download` (arXiv PDF into `.dsh/papers/`, capped at 30 MB, `pdftotext` when installed). No key; 20 s timeout with one retry; the literature-review skill calls these tools |
| `@deepseek-ai/dsh-client-ui-subagent` | shipped client package, **disabled** in this profile: its `subagent-catalog` header cell is replaced by the taskboard's Tasks trigger. Its right-pane child chat tab and `@` reference source are not mounted; child sessions open from the task detail. Re-enable it and use a fresh header id if the lineage popover is needed more than the one-cell replacement |

The harness owns the request pipeline and the user interface, but this kit now adds personas,
a role roster and a deployment policy on top of it. `@deepseek-ai/dsh-agent-preset` declarations
give each role its persona and its tool list; `@cc/dsh-orchestrator` registers a root policy
section and a child specialist section on `agent/created`; `@cc/dsh-skills` registers twenty
runtime skills; `@cc/dsh-flash-guard` rewrites or refuses a delegated child's model route. The
earlier "no plugin contributes prompt text" stance is retired deliberately. A repository's
`AGENTS.md`/`CLAUDE.md` still reaches the model through the upstream loader; the deployment
policy is additional and scoped (root or child), not a replacement for the harness persona. The
model route is whatever the profile configures for the root agent; delegated children default to
flash and may be routed to one of the two allowed Kimi models, and external providers are
outside that seam.

### 1.0 The role presets — tool sets, not prompts

Seven `@deepseek-ai/dsh-agent-preset` declarations sit in the profile patch, and
`@deepseek-ai/dsh-agent-preset-registry` defaults new sessions to it:
`preset-orchestrator`, `preset-ux`, `preset-backend`, `preset-research`, `preset-reviewer`,
`preset-critic`, `preset-docs`. A preset is the persona AND the tool list, so the isolation is
registration, not a brief: the orchestrator reads (`read`, `readImage`) and has no `write`,
`edit`, `bash` or
`pwsh` at all; the research role has no shell and cannot surgically edit; the reviewer can run
and read, and its `write`/`edit` tools are disabled - but it HAS `tool-bash`, and **a shell
can write**: "cannot write" means "cannot use the write/edit tools", not "cannot change a
file". The same is true of the critic, whose `tool-fs` now carries `write: false` and
`edit: false` for the same reason (its persona says never fix). The backend, ux and docs roles
have the full shell and filesystem.

**`critic` is the seventh, and it is a different job from `reviewer`.** The reviewer judges a
diff and does not write; the critic attacks a RUNNING behaviour - a service, a CLI, an
algorithm - with realistic non-trivial inputs and sequences, on a disposable copy (`/tmp`, a
scratch checkout, a copy of the data), and reports the smallest reproducible failure or what
it tried and what stayed untested. It never fixes and never touches production data, and its
preset carries no browser: UI crash testing stays with `ux`. `delegate_task` maps CRITIC,
CRITIC-GENERAL, TESTER and QA to `critic`; AUDIT stays on `reviewer`.
`delegate_task` maps a role name to its preset and passes `agentPreset` in the start request; a
provider without `capabilities.agentPreset` is refused before a child exists, because the child
would silently inherit the orchestrator composition and the brief would promise work it cannot
do. Kit tools that only one role should see gate on the same recorded id through `agent/created`
plus `agent.ctx.tools.register`: `papers_*` to research, `babysitter_*` to the orchestrator,
`diagram`/`presentation` to the orchestrator and ux, and `design_map` to the **orchestrator
only**. `standard` stays in the picker as the
hands-on escape hatch, and a session with no recorded preset keeps every capability-gated tool,
so an unknown composition is never silently degraded - except `design_map`, which fails closed
because it is an ownership boundary, not a capability.

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

Pinned harness version: **`0.2.1-rc.2`**. Node ≥ 24. The kit is the only source of the
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
npm; headroom goes through `uv tool install`, with `uv` itself installed on demand and
`~/.local/bin` added to the user PATH. Measured 2026-10-29 on Windows: `--check` went from
0/8 to 8/8 after `--apply`, and each binary answered `--version`.

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

**Headroom — compression in front of the model (proxy + overlay).** Owned by one script:

```bash
node scripts/headroom.mjs doctor      # binary, health, marker, overlay
node scripts/headroom.mjs enable      # write the marker + overlay, start the proxy
node scripts/headroom.mjs status      # is it up, and is the overlay live
node scripts/headroom.mjs disable --stop
node scripts/headroom.mjs run         # foreground: hold the proxy for a supervisor
node scripts/headroom.mjs unit        # print a systemd user unit that runs `run`
```

`enable` starts `headroom proxy --port 8787 --anthropic-api-url
https://api.deepseek.com/anthropic` detached, with the beacon and tool-schema deferral off,
then waits until the port answers **as a headroom proxy configured for that upstream**.
`start.sh` calls `ensure` on every boot **while the marker exists** and adds
`--patch $DSH_HOME/headroom/patch.yml` only when the proxy answers; if it does not, the boot
proceeds WITHOUT compression and says so. That ordering is the whole safety argument: a base
URL pointing at a dead loopback port fails every request, so the overlay is never applied to
an unhealthy proxy. `HEADROOM=0 ./start.sh` bypasses all of it for one boot.

The health answer is identity, not the proxy's own opinion. `/readyz` returns 503 whenever ANY
dependency is unhappy, and its `upstream` check flaps here: measured 2026-10-30, `/readyz`
answered 503 at 11:52:47 and 200 at 11:53:06 for the same process, which forwarded every model
request in between. A gate that read 503 as "no proxy" dropped compression at boot and called
its own proxy a stranger holding the port. So `ensure`/save accepts a non-2xx answer when the
body names `headroom-proxy` and the upstream it is configured for is the one asked for — a
foreign listener cannot answer that, and a proxy pointed at another upstream is refused with
that fact in the message. The proxy's verdict is still reported (`ready:`, `checks:`) rather
than hidden.

**If you launch `dsh web` directly instead of `./start.sh`, nothing restarts a dead proxy** —
the detached child from `enable` is supervised by nobody, and a proxy that dies quietly turns
every turn into `DeepSeek Messages transport failed`. A boot script is not a supervisor, so
`run` holds the proxy in the foreground (it exits when the proxy exits) and `unit` prints the
systemd user unit that runs it with `Restart=always`. Install it once per machine and `dsh web`
is safe on its own:

```bash
node scripts/headroom.mjs run --port 8787   # what the unit executes
node scripts/headroom.mjs unit > ~/.config/systemd/user/headroom.service
systemctl --user daemon-reload && systemctl --user enable --now headroom
loginctl enable-linger "$USER"              # start at boot, not only at login
```

`ensure`/`start` stay harmless beside it: they find the port healthy and start nothing, and
`stop` refuses to signal a proxy it did not launch — stopping a supervised proxy is
`systemctl --user stop headroom`. The unit is Linux-only; on Windows the equivalent is a
scheduled task running `ensure` at logon.

Measured on this machine: a 61 KB JSON tool result went from 19 955 to 8 208 input tokens
through the proxy (≈59%), DeepSeek's SSE stream survives it, and an uncompressed cold start
is passed through untouched. Revert is `disable --stop` plus one restart.

**Skills that grow — `@cc/dsh-skill-evolve` (in the profile, nothing to start).** Writes
`<name>/SKILL.md` under `$DSH_HOME/skills`, which the harness's own `skill-filesystem`
provider already scans and hot-reloads. Skills written this way appear in a running
session's catalog without a restart. Keep the previous body in `.history/`, retreat to
`.archive/` for `skill_forget`, and never overwrite a hand-authored skill unless
`replace: true` is passed on purpose. Because the library is plain files, making it shared
between machines is `git init` in that directory — that is the "collective" half of
SkillClaw without a server.

**Sharing that library across devices.** `git init` in `$DSH_HOME/skills`, commit the
`SKILL.md` files, add a remote, and clone it into `$DSH_HOME/skills` on every other machine: the
harness discovers whatever is on disk, so nothing else needs wiring. Keep `.history/` (previous
bodies) and `.archive/` (forgotten skills) out of the repository — they are local history, not
library content. The library is NOT scoped to a machine, so a skill must name its own platform
assumptions in the body: a procedure that lists `%APPDATA%` or PowerShell commands is wrong on
Linux, and a shared library that hides that fact teaches the next machine the wrong command.

**Babysitter — deterministic process runs (npm binary + plugin).** `npm install -g
@a5c-ai/babysitter` (or let the plugin report the missing CLI and stop). It has no DSH
harness, so `@cc/dsh-babysitter` shells out to the CLI and maps each run onto ONE taskboard
task: the run's journal steps become timeline notes, and the task lands in `review` for the
human — never `done`.

**A process must be able to import the SDK**, and the global metapackage nests it
(`@a5c-ai/babysitter/node_modules/@a5c-ai/babysitter-sdk`), so it is NOT resolvable from a
workspace file. This kit installs it beside the processes: `.babysitter/node_modules` holds
`@a5c-ai/babysitter-sdk@6.0.0`, and `.babysitter/processes/` holds the processes —
`release-gate.mjs` runs the kit's two checks as journaled shell tasks. Two rules cost four
failed runs on 2026-11-05 and are stated in that file: `defineTask` must be at MODULE scope
(the runtime replays the process after every effect, and an in-function definition dies with
`Task id ... is already registered`), and `ctx.task()` resolves to the task's RESULT PAYLOAD
(the command's stdout string), not `{ok, exitCode}` and not the on-disk `{status, result}`
envelope. A run's `state: completed` and its exit code are the CLI's verdict, not the
process's: read `output` before believing the work succeeded.

Shell-only processes need nothing else. **LLM-backed** ones need provider credentials of
their own, because babysitter resolves its own model rather than borrowing DSH's. The
credentials this machine already has can serve them — verified 2026-10-26, `genty` reached
DeepSeek and completed its planning calls:

```bash
export AGENT_MUX_API_BASE=https://api.deepseek.com/v1
export AGENT_MUX_API_KEY=...            # the same DeepSeek key the harness stores
genty doctor --json --model deepseek-flash
```

Without `--model`, `genty` defaults to `gpt-4o` and DeepSeek rejects it by name; without
the two variables it fails with "No API credentials found". `babysitter_doctor` reports
that exact message rather than hiding it. `genty doctor` takes well over two minutes here,
so raise the tool's `timeoutMs` when probing by hand.

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


**The role toolchain — seven presets, nine pinned binaries, and two roles that cannot run them.**
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
@deepseek-ai/dsh@0.2.1-rc.2` → profile files under `$DSH_HOME/profiles/web` → every
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
dsh --profile web --dump-config | grep -E "id: (notify|presentation|diagrams|subagent|godot-mcp)"   # every row mounted
```

Then open the token URL `dsh web` printed, and confirm the chat renders, a shell command
runs, and a file edit appears in the sidebar. Ask an agent for a `diagram` and a
`presentation` — both must write a standalone `.html` file that the sidebar preview renders.
Two failures worth recognising: a missing plugin row means the patch layer was overwritten,
and an agent with no `mcp__godot__*` / `mcp__playwright__*` tools means the MCP rows were not
written — both are fixed by re-installing the profile files (§3).

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `http://127.0.0.1:3080/` says authentication required | expected: reopen the `?token=` URL the boot printed |
| `MISSING_CREDENTIAL` | credentials live per machine in `$DSH_HOME/.credentials.yaml`; finish onboarding |
| A plugin change had no effect | the profile composes at boot — restart `dsh web` |
| A subagent stopped mid-task with no report | the server restarted under it; ping it to resume (see §3) — it is not lost, and only its in-flight work is |
| A repacked tarball had no effect | its version was not bumped (§5.2) |
| A command you read here no longer exists | the kit moved on: `node $KIT/scripts/check-documentation.mjs` fails on a named script or plugin that is missing, so run it before trusting the prose |
| A non-Flash model is dispatched for a delegated child | `@cc/dsh-flash-guard` should rewrite or refuse it; check that the row is active and that the child is going through DSH's LLM. An external ACP/SDK/Claude Code provider bypasses `agent/request` by design. The root agent is deliberately not forced (`enforceRoot: false`) |
