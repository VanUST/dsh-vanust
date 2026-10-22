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
| `@cc/dsh-work-modes` | refuses a third concurrent `subagent` child per session with the running agents named (a `workflow` fan-out is deliberately outside it). It injects no prompt section and holds no session state |
| `@cc/dsh-godot-mcp` | keeps the deployment's MCP server list declarative and transportable: owns the canonical spec, resolves the `uvx` launcher the Godot AI bridge needs and the Godot project it starts in, and reports per declared server whether its tools are loadable. It implements no MCP itself — the harness's shipped `@deepseek-ai/dsh-mcp-client` bridge does the connecting, and `scripts/dsh-mcp-sync.mjs` writes the row that bridge loads into `$DSH_HOME/cordis.patch.yml`. **Two rows mount for this server and their ids must differ**: the plugin's own row is `id: godot-mcp` (the kit's convention is that a plugin row's id is its function name), while the bridge row the sync writes is `id: mcp-client-<server id>`. One composition has ONE loader-id namespace and the harness refuses the whole tree on a duplicate — `dsh web` fails to start with `duplicate loader entry id: godot-mcp`, which is what happened when a server id was used as the row id. Do not "tidy" the generated id back to the bare server id; `scripts/check-portability.mjs` fails when a generated id spells an authored one |
| `@cc/dsh-skills` | registers nine runtime skills through `ctx.skills.register`: `ponytail` (test paragraph patched to the proof rule), `grill-me`/`grilling`, `clear-writing`, `explain-webpage`, `explain-diagram` (adapted to the local `diagram` tool), `ui-builder`, `proof-not-tests`, `literature-review`. The tarball is the source of truth; no `$DSH_HOME/skills` copy |
| `@cc/dsh-flash-guard` | one `agent/request` waterfall. A delegated child (`delegationDepth > 0` or a `parentSession` header) whose route is not in `allowedRoutes` is rewritten to `deepseek-official/deepseek-flash` or refused before dispatch. `enforceRoot: false` keeps the human's own model choice; external ACP/SDK/Claude Code providers bypass the seam and are the stated residual |
| `@cc/dsh-proof-guard` | one `tools/pre-execute` waterfall on `write`/`edit`. A path matching the test conventions needs a `PROOF:` header (`Behavior:`, `Fails when:`, `Production path:`); a legacy file that already carries one is allowed. `mode: deny` is the default, `warn` the trial. Friction, not proof: a shell write and a fake header are outside it |
| `@cc/dsh-taskboard` | the workspace task ledger and the Tasks panel. One `.dsh/taskboard.json` per workspace holds objective, scope, non-scope, acceptance, status, owner, results and a timeline; `task_create`/`task_get`/`task_list`/`task_update` (CAS)/`task_note`/`task_link` share one Host service with the `/taskboard` command. The client half reads through `workspaceFiles`, writes through `commands`, registers `main` key `tasks`, the `sidebar.panellist` entry and the `subagent-catalog` header cell. It replaces the subagent catalog; `@deepseek-ai/dsh-client-ui-subagent` is disabled in the profile so the header has one cell, and child sessions open from the task detail. Pause/Resume, Close and Remove are lifecycle actions: pause interrupts linked children through `ctx.subagents`, close marks done and interrupts, remove deletes the ledger row and leaves children running. Each linked child records its role and active/sleeping/paused state for the panel roster |
| `@cc/dsh-orchestrator` | root-only policy section (`deployment:orchestrator-policy`), child-only section (`deployment:specialist-policy`) and a root-only `delegate_task` tool. The tool creates the task, renders a self-contained brief (objective, scope, non-scope, inputs, acceptance, output, proof, timebox), starts a flash child with `agentOptions`, and links the child id. The task is created before the child, so a failed start leaves a visible blocked task |
| `@cc/dsh-handoff` | one tool, `handoff`, that renders a structured result into a self-contained A4 HTML page and, when Chrome/Chromium is on PATH or `CHROME_PATH` names one, a PDF beside it. The HTML is the source of truth; a missing browser is a warning |
| `@cc/dsh-papers` | the paper-research tool family: `papers_search` (arXiv Atom + Hugging Face JSON, one source can fail while the other returns), `papers_trending` (HF daily papers) and `papers_download` (arXiv PDF into `.dsh/papers/`, capped at 30 MB, `pdftotext` when installed). No key; 20 s timeout with one retry; the literature-review skill calls these tools |
| `@deepseek-ai/dsh-client-ui-subagent` | shipped client package, **disabled** in this profile: its `subagent-catalog` header cell is replaced by the taskboard's Tasks trigger. Its right-pane child chat tab and `@` reference source are not mounted; child sessions open from the task detail. Re-enable it and use a fresh header id if the lineage popover is needed more than the one-cell replacement |

The harness owns the persona, the request pipeline and the user interface, but this kit now
adds a deployment policy on top of it. Three plugins contribute model-visible text or route
policy: `@cc/dsh-orchestrator` registers a root policy section and a child specialist
section on `agent/created`; `@cc/dsh-skills` registers nine runtime skills; `@cc/dsh-flash-guard`
rewrites or refuses a delegated child's model route. The earlier "no plugin contributes
prompt text" stance is retired deliberately. A repository's `AGENTS.md`/`CLAUDE.md` still
reaches the model through the upstream loader; the deployment policy is additional and
scoped (root or child), not a replacement for the harness persona. The model route is
whatever the profile configures for the root agent; only delegated children are forced to
flash, and external providers are outside that seam.

### 1.1 Hindsight memory — third-party, installed outside the kit

The only plugin that is deliberately not in this repository is Hindsight:

```bash
npx @vectorize-io/hindsight-coding-agents@0.8.2 install dsh
```

It stages its runtime under `~/.hindsight/coding-agents`, writes a `hindsight` row into
`$DSH_HOME/cordis.patch.yml` (the **home** layer, so every profile composes it), and writes
`~/.agents/skills/hindsight-coding-agent/SKILL.md`. Settings are read from
`~/.hindsight/coding-agent.json`; `serverMode` is `cloud`, `self-hosted` or `daemon`.
The current machine's file is `disabled: false`, `serverMode: "daemon"`, `apiPort: 18888`.
It points at a local daemon started with the native DeepSeek provider; the daemon uses the
stored `DEEPSEEK_API_KEY` only in its process environment, never in this JSON file:

```bash
KEY=$(python3 -c 'import yaml; print(yaml.safe_load(open("'"$DSH_HOME"'/.credentials.yaml"))["refs"]["DEEPSEEK_API_KEY"])')
HINDSIGHT_API_LLM_PROVIDER=deepseek \
HINDSIGHT_API_LLM_API_KEY="$KEY" \
HINDSIGHT_API_LLM_MODEL=deepseek-chat \
HINDSIGHT_API_PORT=18888 \
node ~/.hindsight/coding-agents/dist/daemon-start.js --harness dsh
```

The daemon writes no key into the kit. It starts embedded PostgreSQL and serves
`http://127.0.0.1:18888`; `GET /health` reports `{"status":"healthy","database":"connected"}`.
It is not supervised and does not auto-start after reboot. A Cloud bank instead sets
`apiToken` in the JSON. The bank is resolved per session workspace
(`bankIdTemplate: "coding-agent::{gitProject}"`). Hindsight tools register at DSH boot, so
restart DSH after enabling or after the daemon first becomes healthy.

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
  harness when it differs, then records what it applied.
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
dsh --profile web --dump-config | grep -E "id: (notify|presentation|diagrams|work-modes|godot-mcp)"   # every row mounted
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
