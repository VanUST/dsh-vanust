# DEPLOYMENT.md — operating this machine's DeepSeek Harness

This file is the procedure for setting up, starting, updating and verifying the
DeepSeek Harness deployment on a machine. It is written to be read by an AGENT that
was asked to do the work, and it is installed to `$DSH_HOME/DEPLOYMENT.md` by the
installers. The commands here are the ones that are checked: `scripts/check-instruction-routing.mjs`
fails if a file this document names is missing, if the harness pin below disagrees with
the installers, or if the clone URL disagrees with `README.md`.

`$DSH_HOME` is `~/.npm/dsh` on Linux/macOS and `%USERPROFILE%\.npm\dsh` on Windows,
unless the `DSH_HOME` environment variable overrides it.

## 1. What this deployment is

The upstream harness plus six plugins, all pinned and installed from one kit repository:

| Piece | What it does |
|---|---|
| `@deepseek-ai/dsh-model-gate` | cost policy: every dispatch whose model is not Flash-class is vetoed before it costs anything |
| `@cc/dsh-kit-rules` | contributes `$DSH_HOME/AGENTS.md` (this deployment's binding rules) to every session's system prompt |
| `@cc/dsh-context` | `context_module`, `context_rules`, `context_specs`, `ratchet_reconcile` — answers about the current project from `.dsh/project.json` |
| `@cc/dsh-ratchet` | compiles `docs/adrs/*.adr.md` into laws, verifies code against them, and puts proposed decisions to the human as a question |
| `@cc/dsh-adr-panel` | the web UI's window on those decisions and the spec documents: a session-header button opens an overlay listing the records, and its only ratification affordance asks the agent to run the quiz |
| `@cc/dsh-presentation` | one tool, `presentation`, that renders a JSON deck spec into a standalone HTML file in the workspace; the Sidebar document preview displays it, so the file the user previews is the file they export and print |

Pinned harness version: **`0.1.5-rc.1`**. Node ≥ 24. The kit is the only source of the
deployment's files; a machine is a projection of it.

## 2. Fresh machine

```bash
git clone https://github.com/VanUST/dsh-vanust.git ~/dsh-kit
cd ~/dsh-kit
./install.sh                  # Windows: powershell -ExecutionPolicy Bypass -File install.ps1
./start.sh                    # Windows: .\start.ps1     (dsh web --port 3080)
```

`install.sh` / `install.ps1` are idempotent: Node check → pinned `npm i -g
@deepseek-ai/dsh@0.1.5-rc.1` → profile files under `$DSH_HOME/profiles/web` → every
`plugins/*.tgz` installed into that profile → `$DSH_HOME/AGENTS.md` and
`$DSH_HOME/DEPLOYMENT.md` → the development links (§4).

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
- `--apply` writes the canonical profile files, `AGENTS.md`, `DEPLOYMENT.md`, reinstalls
  every drifted plugin tarball with the pinned pnpm (dropping the profile lockfile and
  pruning the store first, because pnpm keys a `file:` dependency by its path string),
  installs the pinned harness when it differs, then records what it applied.
- A machine that disagrees with the kit cannot look converged: `--check` exits non-zero
  and names the files.
- Restart `dsh web` afterwards — the profile is composed once, at boot.
- **A restart kills every subagent running in a session, because they run inside the server
  process.** They are not lost — the session keeps them and a later message resumes one from
  where it stopped — but work in flight is gone and nothing re-runs it by itself. So: do not
  restart while a subagent is mid-task unless you are willing to re-run it, and after a restart
  PING each subagent you still need (`send_message`, or start a fresh one) before assuming its
  report is coming. Treat an unfinished subagent as an outstanding item, not as a silent
  failure.

`$KIT` is the clone's directory. If you do not know it, read it from
`$DSH_HOME/.dsh-kit-state.json` (`kit`), or ask: `node <kit>/scripts/kit-update.mjs --help`.

## 4. Run the kit's own gate (before trusting a change)

The deployment does not need this; the kit's self-check does. The ratchet's tool adapter
imports `@deepseek-ai/dsh-tools`, which lives in the harness install rather than in the
repository, so a fresh clone links it once:

```bash
node "$KIT/scripts/dev-link.mjs"                    # once per clone; install.sh does it
node --test "$KIT/scripts/test-ratchet.mjs"         # the ratchet's full suite
node "$KIT/scripts/check-portability.mjs"           # platform assumptions + packaging
node "$KIT/scripts/check-zone-coverage.mjs" --root "$KIT"   # every tracked path zoned or excepted
node "$KIT/scripts/probe-dsh-api.mjs" --kit-rules    # the rules reach an assembled prompt (behavioral)
node "$KIT/plugins/ratchet/ratchet-cli.mjs" verify --root "$KIT"   # the kit's own gate
node "$KIT/plugins/ratchet/ratchet-cli.mjs" falsify --root "$KIT"  # break the gate, require it to fail
```

`verify` exit codes: `0` every law held, `1` a check failed, `2` the project or its
decisions are unusable so nothing was checked, `3` a usage error. A verification that
could not evaluate every check is a failure, not a pass.

`falsify` is the breaker and its exit codes are its own: `0` every applicable case was
detected, `1` a case was missed (a check that cannot fail), `2` the project is unusable.
It mutates the project and restores everything it touched, including the persisted
verdict, and writes only inside the scopes the manifest declares. It runs the whole gate
once per case, so give it about a minute. `SIGKILL` cannot be caught, but every mutation is
journaled before it is written, so `ratchet falsify --recover` (or the next `falsify`
run) repairs what a hard kill left behind.

## 5. Rules you must not break while operating this

1. **The harness pin is exact.** Never `npm i -g @deepseek-ai/dsh` without a version, and
   never upgrade a live machine outside the gate: install the candidate, run
   `scripts/rebuild-plugins.sh` against a checkout pinned to it, run
   `scripts/verify-upgrade.sh`, and only on PASS touch the live profile. The gate is
   `verify-upgrade.sh`; nothing else authorises an upgrade.
2. **Bump a plugin's version before repacking it.** pnpm serves a `file:` dependency from
   the profile lockfile by path, so a repacked tarball with an unchanged filename does not
   land. The updater warns about it; the version bump is what makes it correct.
3. **Tarballs live in the kit repository.** Never install a plugin from a temporary path.
4. **Never commit machine-local state:** `$DSH_HOME/sessions`, `$DSH_HOME/storages`,
   `.credentials.yaml`, `settings.yaml`, `node_modules`.
5. **The kit's `profile/` files are canonical templates.** `kit-update.mjs` writes them
   over the machine's copies; machine-specific rows belong in a second patch file passed
   with `--patch`, not in `profiles/<name>/cordis.patch.yml`.
6. **Another machine is a remote system.** Reading it is fine; changing it needs the
   user's explicit permission for that exact action, every time.
7. **A prompt-affecting change is verified on a throwaway profile first** — a changed
   `AGENTS.md`, `DEPLOYMENT.md` or `kit-rules` is invisible in `--dump-config` beyond the
   row itself.
8. **A rule is real only where a command fails.** Before claiming something is enforced,
   name the command that exits non-zero when it is broken.

## 6. First-run checks (1 minute, human-visible)

The rules reach a model in the profile you actually use (`web`). Confirm it from inside a
session rather than from a separate profile: **a `--profile headless` run proves nothing
here** — the kit's patch layer is installed for `web`, so a headless run has neither the
loader disable nor the `kit-rules` row and reports `ABSENT` on a healthy machine. Ask the
agent in any GUI session to quote the first line of section 0 of its rules; a correct
answer names `$DSH_HOME/DEPLOYMENT.md`.

**Know what a wrong answer means.** The disable itself is measured to work: compose a
scratch profile from the profile patch and a repository's marked `AGENTS.md` reaches no
model, while without the disable it does. What survives a correct patch is a *running
server*: `dsh web` composes its profile once, at boot, so a server started before the patch
was in place keeps serving the old composition for its whole life — a session can receive
`Instructions from: <path>` while `--dump-config` shows the row disabled. Treat that as
"restart required", not as "the patch is broken": restart through the kit's launcher, then
ask again. This is the one prompt-affecting failure no static check can see, and it is why
the confirmation is a question to the live session.

Then confirm the static half:

```bash
dsh --profile web --dump-config | grep -A1 'kit-rules'   # the row must be mounted
```

Finally open the token URL `dsh web` printed, and confirm the chat renders, a shell command
runs, and a file edit appears in the sidebar. Two failures worth recognising: a missing
plugin row means the patch layer was overwritten, and an agent that reports receiving
`Instructions from: <path>` means the workspace-instruction loader is enabled again — both
are fixed by re-installing the profile files (§3).

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `http://127.0.0.1:3080/` says authentication required | expected: reopen the `?token=` URL the boot printed |
| `MODEL_NOT_ALLOWED` | a non-Flash model is configured; the default must be `deepseek-flash` |
| `MISSING_CREDENTIAL` | credentials live per machine in `$DSH_HOME/.credentials.yaml`; finish onboarding |
| A plugin change had no effect | the profile composes at boot — restart `dsh web` |
| A subagent stopped mid-task with no report | the server restarted under it; ping it to resume (see §4) — it is not lost, and only its in-flight work is |
| A repacked tarball had no effect | its version was not bumped (§5.2) |
| `ERR_MODULE_NOT_FOUND` for `@deepseek-ai/dsh-tools` | the checkout is not linked: `node $KIT/scripts/dev-link.mjs` |
| The gate reports `VERIFY_NOT_RUN` | the laws or the code changed since the recorded verification: run `verify` again |
