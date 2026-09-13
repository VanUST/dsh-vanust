# dsh-kit

Portable setup for **DeepSeek Harness (dsh)** plus the two plugins this
deployment needs beyond upstream, across all your machines (2× Linux, 1× Windows):

- **`@deepseek-ai/dsh-model-gate`** — a class-based flash-only cost policy for the
  official DeepSeek route.
- **`@cc/dsh-context`** — project structure, enforced rules and in-flight work orders
  exposed as tools (`context_module`, `context_rules`, `context_specs`). It is
  project-agnostic: it reads only `.dsh/project.json`, so a Python, C/C++ or Unity
  repository gets the same tools by writing its own manifest.

Clone this repo on a new machine, run `./install.sh` (or `install.ps1` on
Windows), and `dsh web` is up with the same pinned harness version, the same
plugins, and the same core operating rules.

```bash
git clone https://github.com/VanUST/dsh-vanust.git
cd dsh-vanust
./install.sh          # or: powershell -ExecutionPolicy Bypass -File install.ps1
```

```
dsh-kit/
├── install.sh / install.ps1   # fresh-machine setup (Node check → pinned dsh → profile → plugins → rules)
├── start.sh / start.ps1       # easy startup: dsh web --port 3080
├── scripts/kit-update.mjs     # update path: hash drift check + convergence for an existing machine
├── plugins/*.tgz              # plugin tarballs: model-gate (from ~/deepseek-harness),
│                              # and cc-dsh-context (from the project that owns it)
├── profile/                   # canonical web profile: package.json (no deps) + cordis.patch.yml
├── rules/AGENTS.md            # user-global core operating rules (installed to $DSH_HOME/AGENTS.md)
├── scripts/verify-upgrade.sh  # upgrade gate: throwaway instance + shipped-artifact policy probe
├── scripts/rebuild-plugins.sh # rebuild + repack plugins from the harness checkout
├── USERGUIDE.md               # per-machine setup, startup, first-run checks, Windows notes, troubleshooting
└── COMPAT.md                  # upstream API watchlist + the upgrade procedure
```

**Machine-local, never synced:** `$DSH_HOME/sessions`, `$DSH_HOME/storages`,
`.credentials.yaml`, `settings.yaml`, `node_modules`. The harness treats
session files as version-0 format with no compatibility promise — keep them
per-machine (see COMPAT.md §3).

**Plugins** are installed from `plugins/*.tgz` by `install.sh`, which adds every tarball in that
directory.

**Keeping an installed machine current** is `scripts/kit-update.mjs`, which
compares the kit's artifacts by content hash against a machine record
(`$DSH_HOME/.dsh-kit-state.json`), writes the drifted profile files and rules,
reinstalls the drifted tarballs with the pinned pnpm, and installs the pinned
harness when it differs:

```bash
node scripts/kit-update.mjs --check            # report drift, change nothing
node scripts/kit-update.mjs --check --fetch    # same, after asking git for new commits
node scripts/kit-update.mjs --apply            # converge this machine, then record it
```

`kit-update.mjs` is the update path for a machine that is already installed —
including one where a plugin was added to the kit after that machine was set up
(see USERGUIDE §5). Its one rule to know: **bump a plugin's version before
repacking it.** pnpm resolves a `file:` dependency by its path string, so a
tarball that keeps its filename is served from the profile's lockfile snapshot;
the updater drops that lockfile and verifies the installed bytes against the
tarball, so this case is reported rather than passing silently.

`@cc/dsh-context` is built from the project that owns it: `pnpm plugin:pack` there assembles the
package and writes the tarball; copy it here as `cc-dsh-context-<version>.tgz`. Its version lives in
`packages/tooling/src/dsh/plugin-meta.json` in that project, independent of the project's own version,
because this package is installed on its own.

**Upgrades:** the harness is pre-1.0 and breaking changes are policy. Always
go through the gate: `npm i -g @deepseek-ai/dsh@<candidate>` →
`./scripts/rebuild-plugins.sh` → `./scripts/verify-upgrade.sh` → only then
touch the live profile. Details + the API watchlist: **COMPAT.md**.

**Versions:** harness pin `0.1.5-rc.1` · Node ≥ 24 · pnpm 11.7 (corepack).

**License:** MIT (see `LICENSE`); third-party attributions in `NOTICE`.
