# dsh-kit

Portable setup for **DeepSeek Harness (dsh)** + the **web workbench plugin
suite** (PTY terminal, file manager, git review, browser preview) across all
your machines — 2× Linux, 1× Windows.

Clone this repo on a new machine, run `./install.sh` (or `install.ps1` on
Windows), and `dsh web` is up with the same pinned harness version, the same
plugins, and the same core operating rules.

```
dsh-kit/
├── install.sh / install.ps1   # fresh-machine setup (Node check → pinned dsh → profile → plugins → rules)
├── start.sh / start.ps1       # easy startup: dsh web --port 3080
├── plugins/*.tgz              # the three workbench plugin tarballs (built from ~/deepseek-harness)
├── profile/                   # canonical web profile: package.json (no deps) + cordis.patch.yml
├── rules/AGENTS.md            # user-global core operating rules (installed to $DSH_HOME/AGENTS.md)
├── scripts/verify-upgrade.sh  # upgrade gate: throwaway instance + full plugin probe suite
├── scripts/rebuild-plugins.sh # rebuild + repack plugins from the harness checkout
├── USERGUIDE.md               # per-machine setup, startup, first-run checks, Windows notes, troubleshooting
└── COMPAT.md                  # upstream API watchlist + the upgrade procedure
```

**Machine-local, never synced:** `$DSH_HOME/sessions`, `$DSH_HOME/storages`,
`.credentials.yaml`, `settings.yaml`, `node_modules`. The harness treats
session files as version-0 format with no compatibility promise — keep them
per-machine (see COMPAT.md §3).

**Upgrades:** the harness is pre-1.0 and breaking changes are policy. Always
go through the gate: `npm i -g @deepseek-ai/dsh@<candidate>` →
`./scripts/rebuild-plugins.sh` → `./scripts/verify-upgrade.sh` → only then
touch the live profile. Details + the API watchlist: **COMPAT.md**.

**Versions:** harness pin `0.1.1-rc.2` · Node ≥ 24 · pnpm 11.7 (corepack).
