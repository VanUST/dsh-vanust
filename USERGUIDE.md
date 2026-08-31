# USERGUIDE.md — setting up and starting the harness on a new machine

This kit installs **DeepSeek Harness (dsh)** + the web workbench plugin suite
(terminal, file manager, git review, browser) on any of your machines:
2× Linux, 1× Windows. The harness version is pinned; sessions and workspaces
stay machine-local by design (see COMPAT.md §3).

---

## 1. Fresh machine setup

Requirements: **Node.js ≥ 24** (node-pty is ABI-sensitive — keep the same
major on every machine), git, and network access to npm.

### Linux / macOS

```bash
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust
./install.sh          # node check → pinned dsh → web profile → plugins → rules
```

### Windows (PowerShell)

```powershell
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer does five things (idempotent; re-running upgrades to the pin). It installs
into a **user-local npm prefix** (your existing `~/.npm/...` prefix is kept; a fresh
machine gets `~/.npm`) — **no sudo/admin needed**:
1. checks Node ≥ 24,
2. `npm i -g @deepseek-ai/dsh@0.1.1-rc.2` (exact pin),
3. writes `$DSH_HOME/profiles/web/{package.json,cordis.patch.yml}` from the
   kit's canonical copies,
4. installs the three plugin tarballs into the profile (machine-local paths),
5. installs the user-global core operating rules to `$DSH_HOME/AGENTS.md`.

`$DSH_HOME` = `~/.npm/dsh` (Linux) / `%USERPROFILE%\.npm\dsh` (Windows) —
override with the `DSH_HOME` env var if you prefer another location.

## 2. Startup

```bash
./start.sh                 # Linux: dsh web --port 3080 (PORT env to change)
.\start.ps1                # Windows
# or directly:
dsh web --port 3080
```

First run: the GUI opens with an onboarding screen — **configure your API
credentials there** (each machine keeps its own keys in
`$DSH_HOME/.credentials.yaml`; do not sync that file).

## 3. First-run checks (1 minute)

1. Open any workspace/session — the session header (top-right) shows two
   compact toggles: **`>_`** (terminal) and **▤** (workbench).
2. Click `>_`: the chat column **moves up** (i3-style tiling — nothing is
   covered) and a real PTY shell opens in the bottom band. Type `htop` or
   `vim` — full-screen apps must work.
3. (Optional) run TUI tools like micro or yazi inside the terminal — the PTY
   renders full-screen apps fine.
3. Click ▤ → **Files**: browse the workspace tree; select a directory and use
   **Open in terminal** / **yazi** (if installed) / **System file manager**.
4. **Review** tab: shows git changes/diffs when the workspace is a repo.

If the toggles are missing: the plugins did not load — see §5.

## 4. Per-machine configuration

| Item | Linux | Windows |
|---|---|---|
| Credentials | first-run onboarding | same |
| System file manager | default `xdg-open` (nautilus/dolphin/… whatever you have) | **must set `openCommand: explorer`** (see below) |
| TUI file manager (yazi button) | auto-detected on PATH | install yazi to get the button |
| Startup script | `./start.sh` | `.\start.ps1` |
| Shell in terminal | `$SHELL` (bash/zsh/…) | pwsh (auto) |

### Windows: system file manager

Edit `$DSH_HOME\profiles\web\cordis.patch.yml` — add `config` to the
web-workbench row:

```yaml
- insert:
    - id: web-workbench
      name: '@deepseek-ai/dsh-host-web-workbench'
      config:
        openCommand: explorer
```

then restart `dsh web`. (Linux needs no change — `xdg-open` is the default.)

## 5. Migrating an EXISTING machine (instead of fresh install)

The live profile already exists — only the plugin source paths may be stale
(the old kit used `/tmp` paths). Fix:

```bash
cd "$DSH_HOME/profiles/web"
corepack pnpm add /path/to/dsh-kit/plugins/*.tgz   # rewrites to kit paths
cp /path/to/dsh-kit/profile/cordis.patch.yml cordis.patch.yml   # if yours is older
cp /path/to/dsh-kit/rules/AGENTS.md "$DSH_HOME/AGENTS.md"       # refresh rules
```

Then restart `dsh web` and refresh the browser.

## 6. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Toggles missing after install | Plugins not in the profile: `dsh web --dump-config \| grep workbench` (should show 3 rows); re-run the `pnpm add` step |
| Terminal says "Terminal failed" | Host plugin not serving `/wb-api/static/xterm.js` — curl it; host code changed → restart `dsh web` |
| "Session cap reached" | max 4 concurrent PTY sessions (config `maxSessions` in the patch) |
| System FM button errors on Windows | `openCommand` not set — see §4 |
| `dsh web` won't start | port 3080 busy (`PORT=3081 ./start.sh`) or Node < 24 |
| Terminal broken after a harness upgrade | run `scripts/verify-upgrade.sh` before upgrading — see COMPAT.md |
| npm wants to reinstall node-pty | Node major changed — keep Node 24 on every machine (ABI) |

## 7. Upgrades (short version)

See **COMPAT.md** for the full gate. One-liner habit:

```bash
npm i -g "@deepseek-ai/dsh@<candidate>"        # 1. install candidate
./scripts/rebuild-plugins.sh                   # 2. rebuild plugins (same version checkout)
./scripts/verify-upgrade.sh                    # 3. gate on a throwaway instance
# 4. only on PASS: reinstall tarballs + restart the live GUI
```
