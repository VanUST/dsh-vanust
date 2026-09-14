# USERGUIDE.md — setting up and starting the harness on a new machine

This kit installs **DeepSeek Harness (dsh)** on any of your machines (2× Linux,
1× Windows) plus the plugins this deployment adds beyond upstream:
**`@deepseek-ai/dsh-model-gate`** (the class-based flash-only cost policy),
**`@cc/dsh-kit-rules`** (delivers `$DSH_HOME/AGENTS.md` to the model as its
binding rule section), **`@cc/dsh-context`** (a project's modules, rules and work
orders as tools) and **`@cc/dsh-ratchet`** (architecture decisions compiled into
checks a command can fail — §3.2). The harness version is pinned; sessions and
workspaces stay machine-local by design (see COMPAT.md §3).

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

The installer does five things (idempotent; re-running upgrades to the pin):
1. checks Node ≥ 24,
2. `npm i -g @deepseek-ai/dsh@0.1.5-rc.1` (exact pin),
3. writes `$DSH_HOME/profiles/web/{package.json,cordis.patch.yml,pnpm-workspace.yaml}`
   from the kit's canonical copies and installs every `plugins/*.tgz` into the
   profile,
4. installs the user-global core operating rules to `$DSH_HOME/AGENTS.md`,
5. links the harness packages (`@deepseek-ai/dsh-tools`) beside the plugin and the
   probes, which is what lets the kit's own tests and ratchet gate run from this
   checkout. Step 5 is not needed by the deployment — an installed plugin resolves
   its peers through the profile — so if it warns, `dsh web` still works; run
   `node scripts/dev-link.mjs` before using the gate yourself.

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

## 3.2 The ratchet: what it asks of you

`@cc/dsh-ratchet` turns a project's architecture decisions (`docs/adrs/*.adr.md`)
into checks a command can fail. For a project that declares a `ratchet` section in
`.dsh/project.json`, three things involve you rather than the agent:

**1. A decision an agent wrote waits for your yes.** See what is waiting:

```bash
node /path/to/dsh-kit/plugins/ratchet/ratchet-cli.mjs pending --root /path/to/project
```

Each entry prints the record's id, the zones it governs, its **content hash** —
that hash is the exact text a "yes" would cover — and, for a record that cannot be
ratified at all, a `BLOCKED` line with the reason (an agent may not activate a
decision in a zone the project reserves to humans).

**2. The yes itself happens in a session, not in a shell.** Ask the agent to ratify
the pending record; `ratchet_ratify` puts a question to you showing the record's own
text, with an approve answer and a decline answer. Your answer writes an approval
ADR plus a transcript of the exchange. There is deliberately no CLI verb, no tool
argument and no file you can hand the ratchet that would let an agent answer for
you — `pending` prints, and only your answer mints.

**3. Then commit the pair.** The consent binds the text you were shown: editing an
approved record afterwards voids it (`RATIFICATION_STALE`), so the record and its
approval are only meaningful together. Do not accept a hand-written approval file —
one that repeats the channel, time and hash correctly is indistinguishable from a
generated one, and asking an agent to write it is asking it to forge your consent.

Day to day the agent works the other way round: `ratchet_status` reports whether the
code has been checked against the laws currently in force, `ratchet_verify` runs the
deterministic checks (the gate), `ratchet_compile` compiles the records into laws,
`ratchet_review` asks an independent judge the questions no static check can decide,
`ratchet_ingest_source` turns a grilling transcript or a brief into a *proposed*
record, and `ratchet_bootstrap` writes the manifest skeleton. The same operations are
available from the shell — after the one setup step a fresh clone needs, because the
gate runs the kit's tests from the checkout:

```bash
node /path/to/dsh-kit/scripts/dev-link.mjs          # once per clone; install.sh does it
node /path/to/dsh-kit/plugins/ratchet/ratchet-cli.mjs verify --root /path/to/project
# exit 0 every law held, 1 a check failed, 2 the project or its decisions are
# unusable so nothing was checked, 3 a usage error
```

Two limits worth knowing, because both are by design. The shell cannot spawn a
review judge (a shell has no agent to parent one with) — `ratchet review` prints the
prompt it would have sent and says `NOT RUN`, and you can paste it into a session.
And a dynamic review is **advisory**: it never changes the exit code, so an opinion
is never mistaken for the gate.

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

`@cc/dsh-ratchet` registers seven: `ratchet_status`, `ratchet_compile`, `ratchet_verify`, `ratchet_ratify`,
`ratchet_review`, `ratchet_ingest_source` and `ratchet_bootstrap` (§3.2). Check both rows are mounted with:

```bash
dsh --profile web --dump-config | grep -E 'dsh-context|dsh-ratchet'
```
