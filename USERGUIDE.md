# USERGUIDE.md — setting up and starting the harness on a new machine

This kit installs **DeepSeek Harness (dsh)** on any of your machines (2× Linux,
1× Windows) plus the **eight** plugins this deployment adds beyond upstream:
**`@deepseek-ai/dsh-model-gate`** (the class-based flash-only cost policy),
**`@cc/dsh-kit-rules`** (delivers `$DSH_HOME/AGENTS.md` to the model as its
binding rule section), **`@cc/dsh-context`** (a project's modules, rules and work
orders as tools), **`@cc/dsh-specs`** (injects a project's human-authored
`docs/specs/*.md` into every agent's prompt, re-read each assembly),
**`@cc/dsh-adr-panel`** (the Session-header **Specs** button: a frame-wide window
that lists, creates, edits and deletes `docs/specs/*.md` — §3.2),
**`@cc/dsh-work-modes`** (the deployment's concurrency cap — at most two
`subagent` children per session, with a `workflow` fan-out deliberately outside
it; it injects no prompt section),
**`@cc/dsh-presentation`** (one tool that renders a JSON deck spec into a
standalone HTML presentation in the workspace, shown by the Sidebar document
preview) and
**`@cc/dsh-godot-mcp`** (a declarative, transferable MCP server list — §3.3).
`plugins/inventory.json` is the single source of truth for that set and for each
plugin's provenance; `scripts/check-portability.mjs` fails when a tarball, a
mounted profile row, a source directory or a packing entry point disagrees with
it. The harness version is pinned; sessions and workspaces stay machine-local by
design.

The user interface is upstream's own web app: conversations, the right sidebar
with Files and document preview, open-in-app, and the agent's terminal tools all
come from the harness itself, plus the Specs window above.

---

## 1. Fresh machine setup

Requirements: **Node.js ≥ 24**, git, and network access to npm.

### Linux / macOS

```bash
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust
./install.sh          # node check → pinned dsh → web profile → plugin → rules
```

### Windows (PowerShell)

```powershell
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer does five things (idempotent; re-running upgrades to the pin):
1. checks Node ≥ 24,
2. `npm i -g @deepseek-ai/dsh@0.2.0-rc.2` (exact pin),
3. writes `$DSH_HOME/profiles/web/{package.json,cordis.patch.yml,pnpm-workspace.yaml}`
   from the kit's canonical copies and installs every `plugins/*.tgz` into the
   profile,
4. installs the user-global core operating rules to `$DSH_HOME/AGENTS.md`,
5. links the harness packages (`@deepseek-ai/dsh-tools`) beside the plugins and the
   probes, which is what lets the kit's own tests run from this checkout. Step 5
   is not needed by the deployment — an installed plugin resolves its peers through
   the profile — so if it warns, `dsh web` still works; run
   `node scripts/dev-link.mjs` before running the kit's tests yourself.

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
actions (harness / profile / plugins / rules), asks once before applying, and
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

If the UI loads but the agent immediately fails with `MODEL_NOT_ALLOWED`, the
default model is not a Flash-class id — check `$DSH_HOME/settings.yaml`
(`agent-default-model.model`) and the profile patch. If it fails with
`MISSING_CREDENTIAL`, finish the onboarding credential step.

## 3.1 Where the agent's rules come from (and how to change them)

The agent's operating rules are `$DSH_HOME/AGENTS.md`, contributed to the system
prompt by the kit's own `@cc/dsh-kit-rules` plugin as a **binding** section. Three
consequences worth knowing:

- **Edit the file, not the harness.** Save `$DSH_HOME/AGENTS.md` and the change
  applies to the next request in every open session — no restart, because the
  section's text is re-read on each prompt assembly.
- **A repository's `AGENTS.md` does not reach the model.** The harness ships a
  loader that would inject every `AGENTS.md`/`CLAUDE.md` from the project root
  down to the working directory, frame them as guidance and let the most specific
  one win; this deployment disables it (`- id: agent-instructions / disabled:
  true` in `profile/cordis.patch.yml`), because a checkout must not be able to
  override cost policy, remote-change permission or verification duties. Do not
  re-enable it to "also pick up project notes". **Measured, both ways:** compose a
  scratch profile from the profile patch and the loader injects nothing, while
  without the disable a marked `AGENTS.md` in the project reaches the model. **The
  catch is the running server, not the configuration:** a `dsh web` that started
  before the patch was in place keeps its old composition for its whole life, so a
  session can still receive `Instructions from: <path>` while `--dump-config` shows
  the row disabled. The fix is a restart through the kit's launcher (which applies
  the update first); the confirmation is asking the agent, in the session, to quote
  the first line of section 0 of its rules — see §3.1's check below.
- **Project facts belong in `.dsh/project.json`.** That is what the `context_*`
  tools read, and a rule declared there names the command that fails when it is
  broken, which prose never does.

To confirm what the model actually received, ask it **in the session you are already
using** — `--dump-config` proves only that the plugin is mounted, not that the rules
reached the prompt, and a `--profile headless` run does NOT prove it either: the kit's
patch layer is installed for the `web` profile, so a headless run has neither the
disable nor the `kit-rules` row and reports `ABSENT` on a perfectly healthy machine.
In any GUI session, ask the agent to quote the first line of section 0 of its rules.
A correct answer names `$DSH_HOME/DEPLOYMENT.md`; that is the prompt-content proof, from
the profile you actually use.

The static half is one command:

```bash
dsh --profile web --dump-config | grep -A1 'kit-rules'
```

If that row is missing, the patch layer was overwritten — see §5.

## 3.2 The Specs window: where your specs are written

A **button in the Session header** opens a frame-wide overlay on the project's
specs. It lists `docs/specs/*.md`, opens one in a text editor, and saves, creates
or deletes it through one capability-fenced host route.

`@cc/dsh-specs` is the other half: it reads the active specs and contributes them
to the system prompt of every root session and every subagent, re-read on each
prompt assembly, so an edit takes effect on the next request with no restart. A
spec whose frontmatter `status` is absent or exactly `active` is injected;
`draft`, `done` and `inactive` are not.

**Specs are advisory text a human owns.** Nothing compiles them, nothing verifies
code against them, and nothing fails when one is ignored — there is no gate, no
consent step and no verdict anywhere in this deployment. Architecture decision
records under `docs/adrs/` are plain documents a human keeps; nothing reads them
either.

The window **renders no decisions and mints no consent**: it is a file editor over
`docs/specs/`, and the only thing a save produces is the spec file itself.

## 3.3 Connecting Godot (the MCP server list)

`@cc/dsh-godot-mcp` gives the deployment a Godot editor the agent can drive:
scenes, nodes, scripts, signals and UI, through 47 tools published as
`mcp__godot__*`. It speaks no MCP itself — it keeps the **server list** and lets
the harness's own MCP client bridge do the connecting — and the list lives in the
kit, so any machine you converge has the server without you configuring it there.

`profile/mcp-servers.json` in the kit is the canonical list. `kit-update.mjs
--apply` projects it to `$DSH_HOME/mcp-servers.json` and then runs
`scripts/dsh-mcp-sync.mjs`, which writes the launch row the harness actually
loads into `$DSH_HOME/cordis.patch.yml`. Both steps are safe to re-run.

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
`failOnStartupError: false`; the deployment's status section and the sync output
both say the launcher is missing rather than leaving you to guess.

If you ever configure this server from Godot's own AI dock instead, that dock
writes the same `$DSH_HOME/cordis.patch.yml`. The sync **refuses rather than
merges** when it finds entries it did not write, so you will get a named refusal
telling you which file to reconcile — not a silently deleted entry.

## 3.4 Usage analysis: one command

Section 8 of the agent's rules justifies the Flash-only model policy with a measured
usage analysis. To refresh it from a fresh platform export:

```bash
make usage
```

That is the whole procedure. It finds the newest `usage_data_*.zip` in your Downloads
folder, reads it (the ZIP is opened in Node; nothing is unzipped by hand), and writes
three reports into `reports/usage/`, named for the window the export covers:
`<from>_<to>.md`, `.json` and `.html`. It then **opens the HTML page in your browser**.
The HTML report is self-contained — inline CSS, no script, nothing fetched — so it
renders the same from disk, as an attachment, or in a document preview, with no network.

The published copy the rules cite is `docs/usage/2026-09.html`. To refresh that one
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
that refusal as a command, and `make test-usage` proves it *can* fire: one test feeds the
gate an export whose model name is key-shaped and requires exit 1.


## 4. Per-machine configuration

| Item | Linux | Windows |
|---|---|---|
| Credentials | first-run onboarding | same |
| Startup script | `./start.sh` | `.\start.ps1` |
| Default model | `deepseek-flash` in `$DSH_HOME/settings.yaml` | same |
| Shell tooling | upstream `terminal/` family | same |

## 5. Migrating an EXISTING machine

The live profile may still reference the retired workbench/terminal tarballs.
Bring it to the shipped set:

```bash
cd "$DSH_HOME/profiles/web"
corepack pnpm remove @deepseek-ai/dsh-host-web-workbench \
  @deepseek-ai/dsh-client-ui-workbench @deepseek-ai/dsh-client-ui-terminal
corepack pnpm add /path/to/dsh-kit/plugins/*.tgz
cp /path/to/dsh-kit/profile/cordis.patch.yml cordis.patch.yml
cp /path/to/dsh-kit/rules/AGENTS.md "$DSH_HOME/AGENTS.md"
```

Then restart `dsh web` and open the token URL it prints.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `http://127.0.0.1:3080/` says authentication required | Expected since 0.1.5 — reopen the `?token=` URL printed by `dsh web` |
| Agent fails `MODEL_NOT_ALLOWED` | A non-Flash model is configured; set `agent-default-model.model: deepseek-flash` (or widen `allowedModelPatterns` in the profile patch) |
| Agent fails `MISSING_CREDENTIAL` | Credentials not stored — finish onboarding / the Models page |
| `dsh web` won't start | port 3080 busy (`PORT=3081 ./start.sh`) or Node < 24 |
| A plugin row not active after a config edit | The row registers at boot — restart `dsh web` |
| Sessions from the old harness missing/odd after an upgrade | Session formats are not guaranteed across versions; restore the backup taken before the upgrade |

## 7. Upgrades (short version)

One-liner habit:

```bash
npm i -g "@deepseek-ai/dsh@<candidate>"        # 1. install candidate
./scripts/rebuild-plugins.sh                   # 2. rebuild the plugin (matching checkout)
# 3. repoint the live profile + restart the GUI (token URL) only once it composes
```

## Activating a newly added plugin on an already-installed machine

`install.sh` protects an existing profile: if your `$DSH_HOME/profiles/<name>/cordis.patch.yml` differs
from the kit's, it keeps yours and warns instead of overwriting. That is deliberate — the live profile
holds machine-local configuration — but it means a plugin added to the kit after you installed does not
reach your profile automatically.

`scripts/kit-update.mjs --apply` is the supported way to pick one up: it writes the kit's patch layer,
installs every kit tarball with the pinned pnpm, and verifies the installed bytes against each tarball.
What it deliberately does **not** do is merge your own edits into the patch layer — it writes the kit's
copy, so keep machine-specific rows in a second patch file passed with `--patch`, not in
`profiles/web/cordis.patch.yml`.

The manual equivalent, if you want to keep your own patch layer:

```bash
# 1. install the new tarball into your profile.
#    Use the pnpm major that installed the profile: the store layout is versioned
#    (v10 vs v11), and a mismatched pnpm fails with ERR_PNPM_UNEXPECTED_STORE.
#    install.sh installs with ${PNPM_VERSION} above, currently 11.7.0.
cd "$DSH_HOME/profiles/web" && corepack pnpm@11.7.0 add "${KIT_DIR}"/plugins/cc-dsh-context-*.tgz

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
dsh --profile web --dump-config | grep -A1 'dsh-context'
```

A missing entry there means the plugin is installed but not wired.

`@cc/dsh-context` registers three tools: `context_module`, `context_rules` and
`context_specs`. A project without `.dsh/project.json` gets an actionable message naming that file
rather than an empty result — that is the plugin working, not a wiring fault.

`@cc/dsh-specs` injects the project's active `docs/specs/*.md` into every agent's prompt and
registers no tools of its own. Check both rows are mounted with:

```bash
dsh --profile web --dump-config | grep -E 'dsh-context|dsh-specs'
```
