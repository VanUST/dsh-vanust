# USERGUIDE.md — setting up and starting the harness on a new machine

This kit installs **DeepSeek Harness (dsh)** on any of your machines (2× Linux,
1× Windows) plus the **twelve** plugins this deployment adds beyond upstream:
**`@cc/dsh-notify`** (raises a desktop notification — `notify-send`, a PowerShell toast or
`osascript` — when an agent finishes a turn and when it asks you a question; silence it with
`DSH_NOTIFY_DISABLED=1` in the server's environment),
**`@cc/dsh-presentation`** (one tool that renders a JSON deck spec into a
standalone HTML presentation in the workspace, shown by the Sidebar document
preview),
**`@cc/dsh-diagrams`** (one tool that renders a JSON diagram spec into a standalone
HTML document with inline SVG — flowcharts and algorithm illustrations, layered system
designs, sequence diagrams and state machines; you describe nodes and relationships and
the plugin computes the geometry, and the Sidebar document preview shows it),
**`@cc/dsh-work-modes`** (the deployment's concurrency cap — at most two
`subagent` children per session, with a `workflow` fan-out deliberately outside
it; it injects no prompt section) and
**`@cc/dsh-godot-mcp`** (a declarative, transferable MCP server list — §3.2),
**`@cc/dsh-skills`** (fourteen runtime skills: Ponytail, grill-me/grilling, Karpathy
clear-writing/explain-webpage/explain-diagram, the UI builder loop, the proof-not-tests
ruling and literature review),
**`@cc/dsh-flash-guard`** (rewrites or refuses a delegated child's model route unless it is
the configured flash route),
**`@cc/dsh-proof-guard`** (denies a test-file write without a `PROOF:` header),
**`@cc/dsh-taskboard`** (the task ledger and the Tasks panel that replaces the subagent
catalog; `@cc/dsh-client-ui-subagent` is disabled so the header has one cell),
**`@cc/dsh-orchestrator`** (root and child policy sections plus the root-only
`delegate_task` tool) and
**`@cc/dsh-handoff`** (one-page HTML and optional PDF handoff),
**`@cc/dsh-papers`** (arXiv/Hugging Face paper search, HF daily trending, and a PDF
download with text extraction).
`plugins/inventory.json` is the single source of truth for that set;
`scripts/check-portability.mjs` fails when a tarball, a mounted profile row, a
source directory or a packing entry point disagrees with it. The harness version
is pinned; sessions and workspaces stay machine-local by design.

The harness owns the persona, the request pipeline and the user interface; this kit adds a
deployment policy on top: the orchestrator's root/child sections, fourteen runtime skills and a
flash-route guard. A repository's `AGENTS.md`/`CLAUDE.md` still reaches the model through
the harness's own loader. The Tasks panel is the one new primary surface: open it from the
sidebar, or from the **Tasks** header cell in a conversation. Its detail pane is
hideable; Pause/Resume, Close and Remove act on the task, and Pause/Close interrupt
linked child sessions. Each workspace keeps persistent specialist roles (for example UX/UI, BACKEND, BUSINESS,
RESEARCH); a role's child is reused across tasks and shows active/sleeping/paused state. The ledger lives in
`.dsh/taskboard.json` inside the workspace; it is ignored by git and survives a restart.
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

The installer does four things (idempotent; re-running upgrades to the pin):
1. checks Node ≥ 24,
2. `npm i -g @deepseek-ai/dsh@0.2.1-rc.2` (exact pin),
3. writes `$DSH_HOME/profiles/web/{package.json,cordis.patch.yml,pnpm-workspace.yaml}`
   from the kit's canonical copies and installs every `plugins/*.tgz` into the
   profile,
4. installs the operating procedure to `$DSH_HOME/DEPLOYMENT.md`.

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
pin changed in the kit reaches a machine only after a restart. Make the restart
the thing that converges the machine by starting through
`scripts/kit-update.mjs` instead of calling `dsh web` directly:

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
4. Ask for a `diagram` and a `presentation`: each writes a standalone `.html` file in the
   workspace that the sidebar document preview renders.

If it fails with `MISSING_CREDENTIAL`, finish the onboarding credential step. The static
half is one command — every plugin row must be mounted:

```bash
dsh --profile web --dump-config | grep -E "id: (notify|presentation|diagrams|work-modes|godot-mcp)"
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
| `dsh web` won't start | port 3080 busy (`PORT=3081 ./start.sh`) or Node < 24 |
| A plugin row not active after a config edit | The row registers at boot — restart `dsh web` |
| Sessions from the old harness missing/odd after an upgrade | Session formats are not guaranteed across versions; restore the backup taken before the upgrade |

## 7. Upgrades (short version)

One-liner habit:

```bash
npm i -g "@deepseek-ai/dsh@<candidate>"             # 1. install candidate
node scripts/pack-plugin.mjs --dir plugins/notify   # 2. repack each plugin against it
node scripts/check-portability.mjs                  # 3. the checks must pass
# 4. repoint the live profile + restart the GUI (token URL) only once it composes
```

## Activating a newly added plugin on an already-installed machine

`install.sh` protects an existing profile: if your `$DSH_HOME/profiles/<name>/cordis.patch.yml` differs
from the kit's, it keeps yours and warns instead of overwriting. That is deliberate — the live profile
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

It is a new plugin row plus a new package, and this harness cannot import a newly installed
plugin into an ALREADY RUNNING server: after `kit-update` installs it, one restart is needed
(`./start.sh`). Updated versions of an existing plugin do reload on a config change; a *new*
plugin does not, and the loader keeps the failed import until the next boot. This was measured
on 2026-10-26: the row composed, the package was installed and byte-verified, the guard
correct in isolation, and it stayed inactive in the live process.

## 8. The three outside tools (RTK, Headroom, skill evolution, Babysitter)

Each is a decision, not a default; none is required for the harness to run.

| Addition | What it buys | Switch on | Switch off |
|---|---|---|---|
| `@cc/dsh-rtk` | Compresses oversized shell results (`git log/diff`, test runners, `rg`, `find`) before the model reads them | Install the binary: `RTK_EDITION=oss sh <(curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh)` | Nothing to stop; remove the row to disable, or uninstall the binary and the plugin says it is absent |
| `@cc/dsh-skill-evolve` | Skills grow: write, version, dedupe and archive `SKILL.md` under `$DSH_HOME/skills` | Already in the profile — four tools appear (`skill_evolve`, `skill_inventory`, `skill_grow`, `skill_forget`) | Remove the row; the library files stay |
| Headroom proxy | Compresses model traffic itself (prompt payloads, tool results) — measured 19 955 → 8 208 input tokens on a 61 KB JSON result | `node scripts/headroom.mjs enable` then restart, or just `./start.sh` (it calls `ensure`) | `node scripts/headroom.mjs disable --stop`, or `HEADROOM=0 ./start.sh` for one boot |
| `@cc/dsh-babysitter` | Runs a deterministic babysitter process and tracks it as ONE taskboard task | `npm install -g @a5c-ai/babysitter`; rows in the profile | Remove the row; the CLI stays installed |

The one ordering rule that matters: **the proxy must be healthy before the overlay is
applied.** `start.sh` enforces it — with the marker present it runs `ensure` and adds
`--patch $DSH_HOME/headroom/patch.yml` only on success, and prints a line either way. If you
wire it by hand, do the same, or a dead loopback port will refuse every model request.

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
