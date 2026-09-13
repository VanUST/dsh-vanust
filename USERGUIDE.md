# USERGUIDE.md — setting up and starting the harness on a new machine

This kit installs **DeepSeek Harness (dsh)** on any of your machines (2× Linux,
1× Windows) plus the two plugins this deployment adds beyond upstream:
**`@deepseek-ai/dsh-model-gate`**, the class-based flash-only cost policy, and
**`@cc/dsh-context`**, which exposes a project's modules, rules and work orders
as tools. The harness version is pinned; sessions and workspaces stay
machine-local by design (see COMPAT.md §3).

The user interface is upstream's own web app: conversations, the right sidebar
with Files and document preview, open-in-app, and the agent's terminal tools all
come from the harness itself. This kit no longer ships client plugins.

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

The installer does four things (idempotent; re-running upgrades to the pin):
1. checks Node ≥ 24,
2. `npm i -g @deepseek-ai/dsh@0.1.5-rc.1` (exact pin),
3. writes `$DSH_HOME/profiles/web/{package.json,cordis.patch.yml}` from the
   kit's canonical copies and installs the plugin tarball into the profile,
4. installs the user-global core operating rules to `$DSH_HOME/AGENTS.md`.

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
  re-enable it to "also pick up project notes".
- **Project facts belong in `.dsh/project.json`.** That is what the `context_*`
  tools read, and a rule declared there names the command that fails when it is
  broken, which prose never does.

To confirm what the model actually received, ask it in a scratch session — the
row in `--dump-config` proves only that the plugin is mounted, not that rules
reached the prompt:

```bash
dsh --profile headless "Answer only PRESENT or ABSENT: did you receive a block \
beginning 'MANDATORY OPERATING RULES', and did you receive a message framed \
'Instructions from: <path>'?"
```

The first must be `PRESENT` and the second `ABSENT`. If the plugin row is missing
from `dsh --profile web --dump-config`, the patch layer was overwritten — see §5.

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
| Gate not active after a config edit | The row registers at boot — restart `dsh web` |
| Sessions from the old harness missing/odd after an upgrade | Session formats are not guaranteed across versions; restore the backup taken before the upgrade (COMPAT.md §2) |

## 7. Upgrades (short version)

See **COMPAT.md** for the full gate. One-liner habit:

```bash
npm i -g "@deepseek-ai/dsh@<candidate>"        # 1. install candidate
./scripts/rebuild-plugins.sh                   # 2. rebuild the plugin (matching checkout)
./scripts/verify-upgrade.sh                    # 3. gate on a throwaway instance
# 4. only on PASS: repoint the live profile + restart the GUI (token URL)
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

`@cc/dsh-context` registers four tools: `context_module`, `context_rules`, `context_specs` and
`ratchet_reconcile`. A project without `.dsh/project.json` gets an actionable message naming that file
rather than an empty result — that is the plugin working, not a wiring fault.
